import type { Category } from "../../types/database.ts";
import type { ParsedTransaction } from "./types.ts";
import type { PageImage } from "./pdf-to-images.ts";
import { pdfToImages } from "./pdf-to-images.ts";
import { ImportError } from "./errors.ts";
import { extractStreamedObjects } from "./stream-parser.ts";
import { getProvider } from "./providers/index.ts";
import type { LLMConfig } from "./llm-provider.ts";

const PAGES_PER_BATCH = 5;
const MAX_CONCURRENT = 3;
const MAX_BUFFER_BYTES = 1024 * 1024; // 1 MB — safety cap on accumulated LLM response

export interface ParseProgress {
  message: string;
  phase: "rendering" | "analyzing" | "done";
  pageCount?: number;
  fileName?: string;
  batch?: number;
  totalBatches?: number;
}

function buildSystemPrompt(categories: Category[]): string {
  const expense = categories
    .filter((c) => !c.is_income && !c.parent_id)
    .map((c) => c.name);
  const income = categories
    .filter((c) => c.is_income && !c.parent_id)
    .map((c) => c.name);

  return `You are a bank statement parser. Extract every transaction from these statement images.

Output a JSON array where each object has:
- date: YYYY-MM-DD
- payee: cleaned merchant name (no reference numbers, card numbers, or bank codes)
- amount: positive number (no currency symbol)
- type: "income" or "expense" (determine from credit/debit columns or +/- signs)
- category: best match from the list below, or null if unsure
- notes: reference numbers or extra info (optional, empty string if none)

Expense categories: ${expense.join(", ")}
Income categories: ${income.join(", ")}

Rules:
- Output ONLY a JSON array, no markdown fences, no explanation
- Ignore running balances, totals, and summary rows
- Currency is AED
- Each transaction should appear exactly once
- Clean up payee names: remove card numbers, POS terminal IDs, and transaction codes
- For dates, use the transaction date (not posting date) when both are shown`;
}

function deduplicate(transactions: ParsedTransaction[]): ParsedTransaction[] {
  const seen = new Set<string>();
  return transactions.filter((t) => {
    const key = `${t.date}|${t.amount}|${t.payee.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function rawToTransaction(item: any): ParsedTransaction {
  return {
    date: String(item.date ?? ""),
    payee: String(item.payee ?? ""),
    amount: Math.abs(Number(item.amount) || 0),
    type: item.type === "income" ? "income" : "expense",
    category: item.category ? String(item.category) : null,
    category_id: null,
    notes: String(item.notes ?? ""),
    selected: true,
  };
}

export async function parseStatement(
  file: File,
  categories: Category[],
  config: LLMConfig,
  onProgress?: (progress: ParseProgress) => void,
  onTransaction?: (txn: ParsedTransaction) => void,
): Promise<ParsedTransaction[]> {
  // Step 1: Render PDF to images
  onProgress?.({ message: "Loading PDF...", phase: "rendering", fileName: file.name });

  let images: PageImage[];
  try {
    images = await pdfToImages(file, (msg) => {
      onProgress?.({ message: msg, phase: "rendering", fileName: file.name });
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    const msg = (e as Error).message ?? "";
    throw new ImportError(
      "pdf_error",
      "PDF Error",
      msg.includes("password") ? "This PDF is password-protected." : "Failed to read the PDF file.",
      msg.includes("password")
        ? "Remove the password protection and try again."
        : "Make sure the file is a valid PDF document.",
    );
  }

  if (images.length === 0) {
    throw new ImportError(
      "pdf_error",
      "Empty PDF",
      "The PDF has no pages.",
      "Check that you uploaded the correct file.",
    );
  }

  onProgress?.({
    message: `Rendered ${images.length} page${images.length !== 1 ? "s" : ""}`,
    phase: "rendering",
    pageCount: images.length,
    fileName: file.name,
  });

  // Step 2: Batch pages and call LLM in parallel with streaming
  const systemPrompt = buildSystemPrompt(categories);
  const provider = getProvider(config.provider);
  const allTransactions: ParsedTransaction[] = [];
  const categoryMap = buildCategoryMap(categories);

  const batches: PageImage[][] = [];
  for (let i = 0; i < images.length; i += PAGES_PER_BATCH) {
    batches.push(images.slice(i, i + PAGES_PER_BATCH));
  }

  let batchesDone = 0;

  onProgress?.({
    message: "Analyzing statement...",
    phase: "analyzing",
    pageCount: images.length,
    fileName: file.name,
    batch: 0,
    totalBatches: batches.length,
  });

  // Process batches with controlled concurrency
  async function processBatch(batch: PageImage[]) {
    const batchTxns: ParsedTransaction[] = [];
    let parseOffset = 0;
    let accumulated = "";

    const result = await provider.stream(
      config,
      systemPrompt,
      batch.map((img) => img.base64),
      (chunk) => {
        accumulated += chunk;
        if (accumulated.length > MAX_BUFFER_BYTES) {
          throw new ImportError(
            "parse_error",
            "Response Too Large",
            "The AI response exceeded the safety limit.",
            "Try importing fewer pages at once.",
          );
        }
        parseOffset = extractStreamedObjects(accumulated, parseOffset, (obj) => {
          const txn = rawToTransaction(obj);
          txn.category_id = txn.category
            ? (categoryMap.get(txn.category.toLowerCase()) ?? null)
            : null;
          batchTxns.push(txn);
          onTransaction?.(txn);
        });
      },
    );

    if (!result.trim()) {
      throw new ImportError(
        "parse_error",
        "Empty Response",
        "The AI returned an empty response.",
        "Try again — this is usually a transient issue.",
      );
    }

    batchesDone++;
    onProgress?.({
      message: batchesDone < batches.length
        ? `Analyzed ${batchesDone} of ${batches.length} batches...`
        : "Finishing up...",
      phase: "analyzing",
      pageCount: images.length,
      fileName: file.name,
      batch: batchesDone,
      totalBatches: batches.length,
    });

    return batchTxns;
  }

  // Run batches with max concurrency
  const results: ParsedTransaction[][] = [];
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const chunk = batches.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(chunk.map(processBatch));
    results.push(...chunkResults);
  }

  for (const batch of results) {
    allTransactions.push(...batch);
  }

  // Step 3: Deduplicate (category IDs already resolved during streaming)
  const unique = deduplicate(allTransactions);

  if (unique.length === 0) {
    throw new ImportError(
      "no_transactions",
      "No Transactions Found",
      "The AI could not find any transactions in this PDF.",
      "Make sure this is a bank or credit card statement. Scanned images without clear text may not work.",
    );
  }

  onProgress?.({
    message: `Found ${unique.length} transactions`,
    phase: "done",
    pageCount: images.length,
    fileName: file.name,
  });

  return unique;
}

function buildCategoryMap(categories: Category[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) {
    map.set(c.name.toLowerCase(), c.id);
  }
  return map;
}
