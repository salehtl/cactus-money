import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Modal } from "../ui/Modal.tsx";
import { Button } from "../ui/Button.tsx";
import { DatePicker } from "../ui/Calendar.tsx";
import { CategoryCombo } from "../ui/CategoryCombo.tsx";
import { useToast } from "../ui/Toast.tsx";
import { useDb } from "../../context/DbContext.tsx";
import { getSetting, setSetting } from "../../db/queries/settings.ts";
import { parseStatement } from "../../lib/pdf-import/parse-statement.ts";
import { getPageCount } from "../../lib/pdf-import/pdf-to-images.ts";
import { bulkInsertTransactions, getExistingFingerprints, txnFingerprint } from "../../lib/pdf-import/bulk-insert.ts";
import { ImportError } from "../../lib/pdf-import/errors.ts";
import type { ProviderId } from "../../lib/pdf-import/llm-provider.ts";
import { DEFAULT_PROVIDER, PROVIDER_DEFAULTS, PROVIDER_FALLBACK_MODELS, getModelLabel } from "../../lib/pdf-import/providers/index.ts";
import { formatCurrency } from "../../lib/format.ts";
import type { Category } from "../../types/database.ts";
import type { ParsedTransaction, ImportState, ImportFile } from "../../lib/pdf-import/types.ts";
import type { ParseProgress } from "../../lib/pdf-import/parse-statement.ts";

const MAX_TOTAL_PAGES = 50;
const MAX_TRANSACTIONS = 500;

interface PdfImportModalProps {
  open: boolean;
  onClose: () => void;
  files: File[];
  categories: Category[];
}

export function PdfImportModal({ open, onClose, files, categories }: PdfImportModalProps) {
  const db = useDb();
  const { toast } = useToast();
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const runIdRef = useRef(0);
  const txnQueueRef = useRef<ParsedTransaction[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const filesRef = useRef<ImportFile[]>([]);

  const isSingleFile = files.length === 1;

  // Drip queue: reveals buffered transactions one at a time
  function startDraining() {
    if (drainTimerRef.current) return;
    drainTimerRef.current = setInterval(() => {
      const next = txnQueueRef.current.shift();
      if (!next) return;
      setState((prev) => {
        if (prev.step === "streaming") {
          return { ...prev, transactions: [...prev.transactions, next] };
        }
        if (prev.step === "processing") {
          return { step: "streaming", transactions: [next], progress: prev.progress, files: prev.files };
        }
        return prev;
      });
    }, 80);
  }

  function stopDraining() {
    if (drainTimerRef.current) {
      clearInterval(drainTimerRef.current);
      drainTimerRef.current = null;
    }
  }

  function flushQueue() {
    stopDraining();
    const remaining = txnQueueRef.current.splice(0);
    if (remaining.length > 0) {
      setState((prev) => {
        if (prev.step === "streaming") {
          return { ...prev, transactions: [...prev.transactions, ...remaining] };
        }
        return prev;
      });
    }
  }

  useEffect(() => () => stopDraining(), []);

  // For single file: skip file-queue, go straight to processing
  useEffect(() => {
    if (!open || state.step !== "idle") return;
    if (isSingleFile) {
      const importFiles: ImportFile[] = [{ file: files[0], status: "pending", transactionCount: 0 }];
      startProcessing(importFiles);
    } else {
      // Multi-file: enter file-queue step to count pages
      const importFiles: ImportFile[] = files.map((f) => ({ file: f, status: "pending", transactionCount: 0 }));
      setState({ step: "file-queue", files: importFiles });
      countPages(importFiles);
    }
  }, [open, state.step]);

  async function countPages(importFiles: ImportFile[]) {
    const counts = await Promise.all(
      importFiles.map((f) => getPageCount(f.file).catch(() => 0)),
    );
    const updated = importFiles.map((f, i) => ({ ...f, pageCount: counts[i] }));
    setState((prev) => (prev.step === "file-queue" ? { ...prev, files: updated } : prev));
  }

  async function startProcessing(importFiles: ImportFile[]) {
    const runId = ++runIdRef.current;
    const isCurrent = () => runId === runIdRef.current;
    txnQueueRef.current = [];

    try {
      const [provider, apiKey, model, baseUrl] = await Promise.all([
        getSetting(db, "llm_provider"),
        getSetting(db, "llm_api_key"),
        getSetting(db, "llm_model"),
        getSetting(db, "llm_base_url"),
      ]);
      if (!isCurrent()) return;

      const providerId = (provider || DEFAULT_PROVIDER) as ProviderId;
      const needsKey = providerId !== "custom";

      if (needsKey && !apiKey) {
        setState({
          step: "error",
          code: "no_api_key",
          title: "API Key Required",
          message: "You need an API key to import PDFs.",
          suggestion: "Add your API key in Settings under AI Integration.",
        });
        return;
      }

      const updatedFiles = importFiles.map((f) => ({ ...f }));
      filesRef.current = updatedFiles;
      const allTransactions: ParsedTransaction[] = [];
      let txnCapReached = false;

      function syncFiles() {
        setState((prev) => {
          if (prev.step === "processing" || prev.step === "streaming") {
            return { ...prev, files: [...updatedFiles] };
          }
          return prev;
        });
      }

      setState({
        step: "processing",
        progress: { message: "Starting...", phase: "rendering", fileName: updatedFiles[0].file.name },
        files: updatedFiles,
      });

      // Process files sequentially
      for (let fi = 0; fi < updatedFiles.length; fi++) {
        if (!isCurrent()) return;

        const importFile = updatedFiles[fi];
        updatedFiles[fi] = { ...importFile, status: "processing" };
        syncFiles();

        try {
          const transactions = await parseStatement(
            importFile.file,
            categories,
            {
              provider: providerId,
              apiKey: apiKey || "",
              model: model || PROVIDER_DEFAULTS[providerId],
              baseUrl: baseUrl || "",
            },
            (progress) => {
              if (!isCurrent()) return;
              setState((prev) => {
                if (prev.step === "streaming" || prev.step === "processing") return { ...prev, progress };
                return prev;
              });
            },
            (txn) => {
              if (!isCurrent()) return;
              if (txnCapReached) return;
              if (allTransactions.length + txnQueueRef.current.length >= MAX_TRANSACTIONS) {
                txnCapReached = true;
                toast(`Only the first ${MAX_TRANSACTIONS} transactions are shown. The rest were trimmed for safety.`, "warning");
                return;
              }
              txn.sourceFile = importFile.file.name;
              txnQueueRef.current.push(txn);
              startDraining();
            },
          );

          flushQueue();

          updatedFiles[fi] = { ...updatedFiles[fi], status: "done", transactionCount: transactions.length };
          allTransactions.push(...transactions);
          syncFiles();
        } catch (e) {
          flushQueue();

          if (e instanceof ImportError && e.code === "rate_limited_with_fallback") {
            const currentModel = model || PROVIDER_DEFAULTS[providerId];
            const fallback = PROVIDER_FALLBACK_MODELS[providerId]?.[currentModel];
            if (!isCurrent()) return;
            setState({
              step: "rate-limited",
              currentModel,
              fallbackModel: fallback ?? "",
              provider: providerId,
              files: updatedFiles,
              transactions: allTransactions,
            });
            return;
          }

          if (e instanceof ImportError && (e.code === "no_api_key" || e.code === "invalid_api_key" || e.code === "credits_exhausted")) {
            // Fatal errors — stop everything
            if (!isCurrent()) return;
            setState({
              step: "error",
              code: e.code,
              title: e.title,
              message: e.message,
              suggestion: e.suggestion,
            });
            return;
          }

          // Non-fatal: mark file as errored, continue with others
          const errorMsg = e instanceof ImportError ? e.message : (e as Error).message || "Failed to process";
          updatedFiles[fi] = { ...updatedFiles[fi], status: "error", error: errorMsg };
          syncFiles();
        }
      }

      if (!isCurrent()) return;

      if (allTransactions.length > 0) {
        // Mark duplicates against existing DB transactions
        const dates = allTransactions.map((t) => t.date).filter(Boolean);
        const minDate = dates.reduce((a, b) => (a < b ? a : b));
        const maxDate = dates.reduce((a, b) => (a > b ? a : b));
        const existing = await getExistingFingerprints(db, minDate, maxDate);

        const marked = allTransactions.map((t) => {
          const isDup = existing.has(txnFingerprint(t.date, t.amount, t.payee));
          return isDup ? { ...t, duplicate: true, selected: false } : t;
        });

        setState({ step: "reviewing", transactions: marked, files: updatedFiles });
      } else {
        // All files failed or no transactions found
        const failedFiles = updatedFiles.filter((f) => f.status === "error");
        if (failedFiles.length === updatedFiles.length) {
          setState({
            step: "error",
            code: "no_transactions",
            title: "No Transactions Found",
            message: "Could not extract transactions from any of the uploaded files.",
            suggestion: "Make sure the files are bank or credit card statements.",
          });
        } else {
          setState({ step: "reviewing", transactions: [], files: updatedFiles });
        }
      }
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ImportError) {
        setState({ step: "error", code: e.code, title: e.title, message: e.message, suggestion: e.suggestion });
      } else {
        setState({
          step: "error",
          code: "api_error",
          title: "Unexpected Error",
          message: (e as Error).message || "Something went wrong.",
          suggestion: "Try again. If this persists, check your Settings.",
        });
      }
    }
  }

  function handleClose() {
    setState({ step: "idle" });
    onClose();
  }

  const fileCount = files.length;
  const title =
    state.step === "file-queue"
      ? `Import ${fileCount} Statement${fileCount !== 1 ? "s" : ""}`
      : state.step === "processing"
        ? "Importing Statement" + (fileCount > 1 ? "s" : "")
        : state.step === "streaming"
          ? "Analyzing Statement" + (fileCount > 1 ? "s" : "")
          : state.step === "rate-limited"
            ? "Rate Limited"
            : state.step === "reviewing" || state.step === "importing"
            ? "Review Transactions"
            : state.step === "done"
              ? "Import Complete"
              : state.step === "error"
                ? state.title
                : "Import Statement(s)";

  const isWide = state.step === "reviewing" || state.step === "importing" || state.step === "streaming";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      size={isWide ? "wide" : "default"}
    >
      {state.step === "file-queue" && (
        <FileQueueView
          files={state.files}
          onStart={() => startProcessing(state.files)}
          onRemoveFile={(idx) => {
            const next = state.files.filter((_, i) => i !== idx);
            if (next.length === 0) {
              handleClose();
            } else {
              setState({ step: "file-queue", files: next });
            }
          }}
          onCancel={handleClose}
        />
      )}
      {state.step === "processing" && (
        <ProcessingView progress={state.progress} files={state.files} singleFile={isSingleFile} />
      )}
      {state.step === "streaming" && (
        <StreamingView
          transactions={state.transactions}
          progress={state.progress}
          categories={categories}
          files={state.files}
          singleFile={isSingleFile}
        />
      )}
      {state.step === "rate-limited" && (
        <RateLimitedView
          currentModel={state.currentModel}
          fallbackModel={state.fallbackModel}
          provider={state.provider}
          onSwitchModel={() => {
            if (!state.fallbackModel) return;
            const rid = runIdRef.current;
            setSetting(db, "llm_model", state.fallbackModel).then(() => {
              if (rid !== runIdRef.current) return;
              toast(`Switched to ${getModelLabel(state.provider, state.fallbackModel)}`);
              setState({ step: "idle" });
            });
          }}
          onRetry={() => setState({ step: "idle" })}
          onClose={handleClose}
        />
      )}
      {(state.step === "reviewing" || state.step === "importing") && (
        <ReviewView
          transactions={state.transactions}
          categories={categories}
          importing={state.step === "importing"}
          files={state.files}
          singleFile={isSingleFile}
          onImport={async (txns) => {
            setState({ step: "importing", transactions: txns, files: filesRef.current });
            try {
              const count = await bulkInsertTransactions(db, txns);
              const doneFileCount = filesRef.current.filter((f) => f.status === "done").length;
              setState({ step: "done", count, fileCount: doneFileCount || fileCount });
            } catch (e: any) {
              toast(`Import failed: ${e.message}`, "error");
              setState({ step: "reviewing", transactions: txns, files: filesRef.current });
            }
          }}
          onCancel={handleClose}
        />
      )}
      {state.step === "done" && (
        <DoneView count={state.count} fileCount={state.fileCount} onClose={handleClose} />
      )}
      {state.step === "error" && (
        <ErrorView
          code={state.code}
          title={state.title}
          message={state.message}
          suggestion={state.suggestion}
          onRetry={() => setState({ step: "idle" })}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}

// --- File Queue (multi-file only) ---

function FileQueueView({
  files,
  onStart,
  onRemoveFile,
  onCancel,
}: {
  files: ImportFile[];
  onStart: () => void;
  onRemoveFile: (index: number) => void;
  onCancel: () => void;
}) {
  const totalPages = files.reduce((sum, f) => sum + (f.pageCount ?? 0), 0);
  const allCounted = files.every((f) => f.pageCount != null);
  const tooManyPages = totalPages > MAX_TOTAL_PAGES;

  return (
    <div className="py-2 animate-slide-up">
      <div className="space-y-1.5 mb-4">
        {files.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2.5 bg-surface-alt rounded-lg group"
          >
            <svg className="w-4 h-4 text-text-light shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-xs truncate flex-1 min-w-0">{f.file.name}</span>
            {f.pageCount != null ? (
              <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                {f.pageCount} pg{f.pageCount !== 1 ? "s" : ""}
              </span>
            ) : (
              <span className="w-3 h-3 border-2 border-border border-t-accent rounded-full animate-spin shrink-0" />
            )}
            <button
              type="button"
              onClick={() => onRemoveFile(i)}
              className="text-text-light hover:text-danger transition-colors cursor-pointer p-0.5 rounded hover:bg-danger/5 opacity-0 group-hover:opacity-100"
              title="Remove"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between text-xs text-text-muted mb-4">
        <span>
          {files.length} file{files.length !== 1 ? "s" : ""}
          {allCounted && <> · {totalPages} page{totalPages !== 1 ? "s" : ""} total</>}
        </span>
        {tooManyPages && (
          <span className="text-danger font-medium">
            Max {MAX_TOTAL_PAGES} pages allowed
          </span>
        )}
      </div>

      {/* Privacy notice */}
      <p className="text-[11px] text-text-muted mb-4">
        Your statement data will be sent to Anthropic for processing.{" "}
        <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>
      </p>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          onClick={onStart}
          disabled={!allCounted || tooManyPages}
        >
          Start Import
        </Button>
      </div>
    </div>
  );
}

// --- File progress indicator (shared between processing/streaming) ---

function FileProgressStrip({ files, singleFile }: { files: ImportFile[]; singleFile: boolean }) {
  if (singleFile) return null;

  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      {files.map((f, i) => (
        <div
          key={i}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-all ${
            f.status === "processing"
              ? "bg-accent/10 text-accent ring-1 ring-accent/20"
              : f.status === "done"
                ? "bg-success/8 text-success"
                : f.status === "error"
                  ? "bg-danger/8 text-danger"
                  : "bg-surface-alt text-text-light"
          }`}
          title={f.error || f.file.name}
        >
          {f.status === "processing" && (
            <span className="w-2.5 h-2.5 border-[1.5px] border-accent/30 border-t-accent rounded-full animate-spin shrink-0" />
          )}
          {f.status === "done" && (
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {f.status === "error" && (
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          )}
          {f.status === "pending" && (
            <span className="w-2 h-2 rounded-full bg-border shrink-0" />
          )}
          <span className="truncate max-w-[120px]">
            {f.file.name.replace(/\.pdf$/i, "")}
          </span>
          {f.status === "done" && f.transactionCount > 0 && (
            <span className="text-[10px] opacity-70">{f.transactionCount}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Processing ---

const PHASE_META: Record<ParseProgress["phase"], { label: string; icon: JSX.Element }> = {
  rendering: {
    label: "Reading PDF",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  analyzing: {
    label: "Analyzing",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  done: {
    label: "Done",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
};

const PHASES: ParseProgress["phase"][] = ["rendering", "analyzing", "done"];

function ProcessingView({ progress, files, singleFile }: { progress: ParseProgress; files: ImportFile[]; singleFile: boolean }) {
  const currentIdx = PHASES.indexOf(progress.phase);

  return (
    <div className="py-6">
      <FileProgressStrip files={files} singleFile={singleFile} />

      {/* Phase steps */}
      <div className="flex items-center justify-center gap-0 mb-8">
        {PHASES.map((phase, i) => {
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          const meta = PHASE_META[phase];
          return (
            <div key={phase} className="flex items-center">
              {i > 0 && (
                <div className={`w-16 h-px transition-colors duration-500 ${isDone ? "bg-accent" : "bg-border"}`} />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isDone
                      ? "bg-accent text-white"
                      : isCurrent
                        ? "bg-accent/10 text-accent ring-2 ring-accent/30"
                        : "bg-surface-alt text-text-light border border-border"
                  }`}
                >
                  {isDone ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    meta.icon
                  )}
                </div>
                <span className={`text-[10px] font-medium transition-colors duration-300 ${
                  isCurrent ? "text-accent" : isDone ? "text-text-muted" : "text-text-light"
                }`}>
                  {meta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Spinner + message */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-[3px] border-border" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-accent animate-spin" />
        </div>

        <p className="text-sm text-text-muted text-center">{progress.message}</p>

        {progress.fileName && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-alt rounded-md">
            <svg className="w-3 h-3 text-text-light shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-[11px] text-text-light truncate max-w-[200px]">{progress.fileName}</span>
            {progress.pageCount != null && (
              <span className="text-[11px] text-text-light">
                · {progress.pageCount} pg{progress.pageCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {progress.totalBatches != null && progress.totalBatches > 1 && (
          <div className="w-36 mt-1">
            <div className="flex justify-between text-[10px] text-text-light mb-1">
              <span>Batch {progress.batch ?? 1} of {progress.totalBatches}</span>
              <span>{Math.round(((progress.batch ?? 1) / progress.totalBatches) * 100)}%</span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
                style={{ width: `${((progress.batch ?? 1) / progress.totalBatches) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Streaming (transactions arriving live) ---

function StreamingRow({ txn, categories, isNew }: { txn: ParsedTransaction; categories: Category[]; isNew: boolean }) {
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (isNew && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isNew]);

  const cat = txn.category_id ? categories.find((c) => c.id === txn.category_id) : null;

  return (
    <tr
      ref={rowRef}
      className="animate-stream-in"
    >
      <td className="p-2 text-xs tabular-nums text-text-muted whitespace-nowrap">{txn.date}</td>
      <td className="p-2 text-xs">{txn.payee}</td>
      <td className="p-2 text-xs text-right tabular-nums font-medium whitespace-nowrap">
        {formatCurrency(txn.amount)}
      </td>
      <td className="p-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          txn.type === "income" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
        }`}>
          {txn.type === "income" ? "Income" : "Expense"}
        </span>
      </td>
      <td className="p-2 text-xs text-text-muted truncate max-w-[140px]">
        {cat ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
            {cat.name}
          </span>
        ) : (
          <span className="text-text-light italic">—</span>
        )}
      </td>
    </tr>
  );
}

function FileSeparatorRow({ fileName, count }: { fileName: string; count?: number }) {
  return (
    <tr>
      <td colSpan={5} className="px-2 pt-3 pb-1">
        <div className="flex items-center gap-2 text-[10px] text-text-light uppercase tracking-wide">
          <div className="h-px bg-border flex-1" />
          <span className="flex items-center gap-1.5 shrink-0">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {fileName}
            {count != null && <span className="text-text-muted">({count})</span>}
          </span>
          <div className="h-px bg-border flex-1" />
        </div>
      </td>
    </tr>
  );
}

function StreamingView({
  transactions,
  progress,
  categories,
  files,
  singleFile,
}: {
  transactions: ParsedTransaction[];
  progress: ParseProgress;
  categories: Category[];
  files: ImportFile[];
  singleFile: boolean;
}) {
  const prevCountRef = useRef(0);
  const newStartIndex = prevCountRef.current;

  useEffect(() => {
    prevCountRef.current = transactions.length;
  }, [transactions.length]);

  const income = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const doneFiles = files.filter((f) => f.status === "done").length;
  const processingFiles = files.filter((f) => f.status === "processing").length;
  const activeFileCount = doneFiles + processingFiles;

  // Group transactions by sourceFile for separator insertion (inline — no useMemo
  // since `transactions` changes every 80ms during streaming and grouping is O(n))
  let groupedRows: { fileName: string; txns: { txn: ParsedTransaction; globalIndex: number }[] }[] | null = null;
  if (!singleFile) {
    groupedRows = [];
    let currentFile: string | null = null;
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      if (t.sourceFile !== currentFile) {
        currentFile = t.sourceFile ?? null;
        groupedRows.push({ fileName: currentFile ?? "Unknown", txns: [] });
      }
      groupedRows[groupedRows.length - 1].txns.push({ txn: t, globalIndex: i });
    }
  }

  return (
    <div className="animate-slide-up">
      <FileProgressStrip files={files} singleFile={singleFile} />

      {/* Live status bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
            <span className="font-bold text-text tabular-nums">{transactions.length} found</span>
          </span>
          <span className="text-border">·</span>
          {singleFile ? (
            <span className="truncate max-w-[180px]">{files[0]?.file.name}</span>
          ) : (
            <span>{activeFileCount} of {files.length} files</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] tabular-nums">
          {income > 0 && <span className="text-success font-medium">+{formatCurrency(income)}</span>}
          {expense > 0 && <span className="text-danger font-medium">-{formatCurrency(expense)}</span>}
        </div>
      </div>

      {/* Progress indicator */}
      {progress.totalBatches != null && progress.totalBatches > 1 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-text-light mb-1">
            <span>{progress.message}</span>
            <span>{Math.round(((progress.batch ?? 0) / progress.totalBatches) * 100)}%</span>
          </div>
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
              style={{ width: `${((progress.batch ?? 0) / progress.totalBatches) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Streaming table */}
      <div className="max-h-[50vh] overflow-y-auto border border-border rounded-lg scroll-smooth">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt sticky top-0 z-10 border-b border-border">
            <tr className="text-left text-[11px] text-text-muted uppercase tracking-wide">
              <th className="p-2 font-medium">Date</th>
              <th className="p-2 font-medium">Payee</th>
              <th className="p-2 text-right font-medium">Amount</th>
              <th className="p-2 w-20 font-medium">Type</th>
              <th className="p-2 w-36 font-medium">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {singleFile ? (
              transactions.map((txn, i) => (
                <StreamingRow
                  key={i}
                  txn={txn}
                  categories={categories}
                  isNew={i >= newStartIndex}
                />
              ))
            ) : (
              groupedRows?.map((group) => (
                <Fragment key={group.fileName}>
                  <FileSeparatorRow fileName={group.fileName} />
                  {group.txns.map(({ txn, globalIndex }) => (
                    <StreamingRow
                      key={globalIndex}
                      txn={txn}
                      categories={categories}
                      isNew={globalIndex >= newStartIndex}
                    />
                  ))}
                </Fragment>
              ))
            )}
            {/* Analyzing indicator row */}
            <tr>
              <td colSpan={5} className="p-2">
                <div className="flex items-center gap-2 text-text-light">
                  <span className="w-3 h-3 border-2 border-border border-t-accent rounded-full animate-spin" />
                  <span className="text-[11px]">
                    {progress.totalBatches != null && progress.totalBatches > 1
                      ? `Analyzing batch ${progress.batch ?? 1} of ${progress.totalBatches}...`
                      : "Analyzing..."}
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Done ---

function DoneView({ count, fileCount, onClose }: { count: number; fileCount: number; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 animate-slide-up">
      <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
        <svg className="w-7 h-7 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-base font-bold mb-1">
          {count} transaction{count !== 1 ? "s" : ""} imported
        </p>
        <p className="text-xs text-text-muted">
          {fileCount > 1
            ? `From ${fileCount} statements. They'll appear in the cashflow view for their respective months.`
            : "They'll appear in the cashflow view for their respective months."}
        </p>
      </div>
      <Button onClick={onClose} className="mt-1">Done</Button>
    </div>
  );
}

// --- Error ---

const ERROR_CONFIG: Record<string, {
  icon: JSX.Element;
  color: string;
  retryable: boolean;
  settingsLink: boolean;
}> = {
  no_api_key: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
    color: "warning",
    retryable: false,
    settingsLink: true,
  },
  invalid_api_key: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
    color: "danger",
    retryable: false,
    settingsLink: true,
  },
  credits_exhausted: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    color: "warning",
    retryable: false,
    settingsLink: false,
  },
  rate_limited: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    color: "warning",
    retryable: true,
    settingsLink: false,
  },
  network_error: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
    ),
    color: "danger",
    retryable: true,
    settingsLink: true,
  },
  pdf_error: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="12" x2="12" y2="16" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    ),
    color: "text-muted",
    retryable: false,
    settingsLink: false,
  },
  no_transactions: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
    color: "text-muted",
    retryable: true,
    settingsLink: false,
  },
  parse_error: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    color: "warning",
    retryable: true,
    settingsLink: false,
  },
  api_error: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    color: "danger",
    retryable: true,
    settingsLink: false,
  },
};

const COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  warning: { bg: "bg-warning/8", text: "text-warning" },
  danger: { bg: "bg-danger/8", text: "text-danger" },
  "text-muted": { bg: "bg-text-muted/8", text: "text-text-muted" },
};

function RateLimitedView({
  currentModel,
  fallbackModel,
  provider,
  onSwitchModel,
  onRetry,
  onClose,
}: {
  currentModel: string;
  fallbackModel: string;
  provider: ProviderId;
  onSwitchModel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const currentLabel = getModelLabel(provider, currentModel);
  const fallbackLabel = fallbackModel ? getModelLabel(provider, fallbackModel) : null;

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 animate-slide-up">
      <div className="w-14 h-14 rounded-full flex items-center justify-center bg-warning/10 text-warning">
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <div className="text-center max-w-xs">
        <p className="text-sm font-bold mb-1.5">Rate Limited</p>
        <p className="text-xs text-text-muted leading-relaxed">
          The API rate limit was hit while using {currentLabel}. Concurrency was already reduced.
        </p>
      </div>

      <div className="flex items-start gap-2 bg-surface-alt rounded-lg px-3 py-2.5 max-w-xs w-full">
        <svg className="w-3.5 h-3.5 text-text-light shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-[11px] text-text-muted leading-relaxed">
          {fallbackLabel
            ? `You can switch to ${fallbackLabel} which has higher rate limits, or wait a minute and retry with ${currentLabel}.`
            : `Wait a minute and retry. ${currentLabel} is already the most affordable model for this provider.`}
        </p>
      </div>

      <div className="flex gap-2 mt-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button variant="secondary" size="sm" onClick={onRetry}>Wait & Retry</Button>
        {fallbackLabel && (
          <Button size="sm" onClick={onSwitchModel}>
            Switch to {fallbackLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function ErrorView({
  code,
  title,
  message,
  suggestion,
  onRetry,
  onClose,
}: {
  code: string;
  title: string;
  message: string;
  suggestion: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const config = ERROR_CONFIG[code] ?? ERROR_CONFIG["api_error"]!;
  const colors = COLOR_CLASSES[config.color] ?? COLOR_CLASSES["danger"]!;

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 animate-slide-up">
      {/* Icon */}
      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${colors.bg} ${colors.text}`}>
        {config.icon}
      </div>

      {/* Message */}
      <div className="text-center max-w-xs">
        <p className="text-sm font-bold mb-1.5">{title}</p>
        <p className="text-xs text-text-muted leading-relaxed">{message}</p>
      </div>

      {/* Suggestion box */}
      <div className="flex items-start gap-2 bg-surface-alt rounded-lg px-3 py-2.5 max-w-xs w-full">
        <svg className="w-3.5 h-3.5 text-text-light shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-[11px] text-text-muted leading-relaxed">{suggestion}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
        {config.settingsLink && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onClose();
              navigate({ to: "/settings" });
            }}
          >
            Open Settings
          </Button>
        )}
        {config.retryable && (
          <Button size="sm" onClick={onRetry}>Retry</Button>
        )}
      </div>
    </div>
  );
}

// --- Review table ---

function ReviewView({
  transactions: initial,
  categories,
  importing,
  files,
  singleFile,
  onImport,
  onCancel,
}: {
  transactions: ParsedTransaction[];
  categories: Category[];
  importing: boolean;
  files: ImportFile[];
  singleFile: boolean;
  onImport: (txns: ParsedTransaction[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<ParsedTransaction[]>(initial);
  const [fileFilter, setFileFilter] = useState<string | null>(null);
  const [uncategorizedFilter, setUncategorizedFilter] = useState(false);

  const sourceFiles = useMemo(() => {
    if (singleFile) return [];
    const names = new Set<string>();
    for (const r of rows) if (r.sourceFile) names.add(r.sourceFile);
    return Array.from(names);
  }, [rows, singleFile]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (fileFilter) result = result.filter((r) => r.sourceFile === fileFilter);
    if (uncategorizedFilter) result = result.filter((r) => r.selected && !r.category_id);
    return result;
  }, [rows, fileFilter, uncategorizedFilter]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => r.selected);

  const { totals, uncategorizedCount, duplicateCount } = useMemo(() => {
    let income = 0, expense = 0, uncategorized = 0, duplicates = 0;
    for (const r of rows) {
      if (r.duplicate) duplicates++;
      if (!r.selected) continue;
      if (r.type === "income") income += r.amount;
      else expense += r.amount;
      if (!r.category_id) uncategorized++;
    }
    return { totals: { income, expense }, uncategorizedCount: uncategorized, duplicateCount: duplicates };
  }, [rows]);

  // Auto-clear uncategorized filter when none remain
  useEffect(() => {
    if (uncategorizedFilter && uncategorizedCount === 0) setUncategorizedFilter(false);
  }, [uncategorizedFilter, uncategorizedCount]);

  // Failed files warning
  const failedFiles = files.filter((f) => f.status === "error");

  function getRowGlobalIndex(filteredIndex: number): number {
    if (!fileFilter && !uncategorizedFilter) return filteredIndex;
    const targetRow = filteredRows[filteredIndex];
    return rows.indexOf(targetRow);
  }

  function updateRow(filteredIndex: number, updates: Partial<ParsedTransaction>) {
    const globalIndex = getRowGlobalIndex(filteredIndex);
    setRows((prev) =>
      prev.map((r, i) => (i === globalIndex ? { ...r, ...updates } : r)),
    );
  }

  function removeRow(filteredIndex: number) {
    const globalIndex = getRowGlobalIndex(filteredIndex);
    setRows((prev) => prev.filter((_, i) => i !== globalIndex));
  }

  function toggleAll() {
    const newVal = !allSelected;
    if (fileFilter || uncategorizedFilter) {
      // Only toggle rows matching the current filter(s)
      const filteredSet = new Set(filteredRows);
      setRows((prev) => prev.map((r) => (filteredSet.has(r) ? { ...r, selected: newVal } : r)));
    } else {
      setRows((prev) => prev.map((r) => ({ ...r, selected: newVal })));
    }
  }

  const summaryLabel = singleFile
    ? `${rows.length} transactions · ${files[0]?.file.name ?? ""}`
    : `${rows.length} transactions · ${sourceFiles.length} files`;

  return (
    <div className="animate-slide-up">
      {/* Failed files warning */}
      {failedFiles.length > 0 && (
        <div className="flex items-start gap-2 bg-warning/8 text-warning rounded-lg px-3 py-2 mb-3 text-xs">
          <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            {failedFiles.length} file{failedFiles.length !== 1 ? "s" : ""} failed:{" "}
            {failedFiles.map((f) => f.file.name).join(", ")}
          </span>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5 text-xs text-text-muted">
          <span className="font-bold text-text">{summaryLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {duplicateCount > 0 && (
            <span className="text-[11px] text-text-muted bg-surface-alt px-2 py-0.5 rounded-full font-medium border border-border">
              {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} skipped
            </span>
          )}
          {uncategorizedCount > 0 && (
            <button
              type="button"
              onClick={() => setUncategorizedFilter((v) => !v)}
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${
                uncategorizedFilter
                  ? "bg-warning/20 text-warning ring-1 ring-warning/40"
                  : "text-warning bg-warning/8 hover:bg-warning/14"
              }`}
            >
              {uncategorizedCount} uncategorized
            </button>
          )}
        </div>
      </div>

      {/* File filter chips (multi-file only) */}
      {!singleFile && sourceFiles.length > 1 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <button
            type="button"
            onClick={() => setFileFilter(null)}
            className={`text-[11px] px-2 py-1 rounded-md transition-colors cursor-pointer ${
              !fileFilter
                ? "bg-accent/10 text-accent font-medium"
                : "bg-surface-alt text-text-muted hover:bg-surface-alt/80"
            }`}
          >
            All ({rows.length})
          </button>
          {sourceFiles.map((name) => {
            const count = rows.filter((r) => r.sourceFile === name).length;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setFileFilter(fileFilter === name ? null : name)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors cursor-pointer truncate max-w-[160px] ${
                  fileFilter === name
                    ? "bg-accent/10 text-accent font-medium"
                    : "bg-surface-alt text-text-muted hover:bg-surface-alt/80"
                }`}
              >
                {name.replace(/\.pdf$/i, "")} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="max-h-[55vh] overflow-y-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt sticky top-0 z-10 border-b border-border">
            <tr className="text-left text-[11px] text-text-muted uppercase tracking-wide">
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded"
                  disabled={importing}
                />
              </th>
              <th className="p-2 font-medium">Date</th>
              <th className="p-2 font-medium">Payee</th>
              <th className="p-2 text-right font-medium">Amount</th>
              <th className="p-2 w-20 font-medium">Type</th>
              <th className="p-2 w-36 font-medium">Category</th>
              <th className="p-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <div className="text-text-light">
                    <svg className="w-8 h-8 mx-auto mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <p className="text-xs">{uncategorizedFilter ? "All transactions are categorized" : fileFilter ? "No transactions from this file" : "All transactions removed"}</p>
                  </div>
                </td>
              </tr>
            )}
            {filteredRows.map((row, i) => (
              <ReviewRow
                key={`${row.sourceFile}-${row.date}-${row.payee}-${row.amount}-${i}`}
                row={row}
                index={i}
                categories={categories}
                onUpdate={updateRow}
                onRemove={removeRow}
                disabled={importing}
                showSourceFile={!singleFile && !fileFilter}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-text-muted">
            <strong className="text-text">{selectedCount}</strong> selected
          </span>
          {totals.income > 0 && (
            <span className="text-success font-medium">+{formatCurrency(totals.income)}</span>
          )}
          {totals.expense > 0 && (
            <span className="text-danger font-medium">-{formatCurrency(totals.expense)}</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onImport(rows)}
            disabled={selectedCount === 0 || importing}
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importing...
              </span>
            ) : (
              `Import ${selectedCount} Transaction${selectedCount !== 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  row,
  index,
  categories,
  onUpdate,
  onRemove,
  disabled,
  showSourceFile,
}: {
  row: ParsedTransaction;
  index: number;
  categories: Category[];
  onUpdate: (index: number, updates: Partial<ParsedTransaction>) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
  showSourceFile: boolean;
}) {
  const isUncategorized = row.selected && !row.category_id;
  const isDuplicate = !!row.duplicate;

  return (
    <tr
      className={`transition-colors ${
        row.selected ? "" : "opacity-35"
      } ${
        isDuplicate
          ? "bg-text-muted/[0.03]"
          : isUncategorized
            ? "bg-warning/[0.03]"
            : index % 2 === 1 ? "bg-surface-alt/30" : ""
      } hover:bg-surface-alt/50`}
    >
      <td className="p-2">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onUpdate(index, { selected: e.target.checked })}
          className="rounded"
          disabled={disabled}
        />
      </td>
      <td className="p-2">
        <DatePicker
          value={row.date}
          onChange={(date) => onUpdate(index, { date })}
          variant="inline"
          disabled={disabled}
        />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={row.payee}
            onChange={(e) => onUpdate(index, { payee: e.target.value })}
            className="bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none text-xs flex-1 min-w-0"
            disabled={disabled}
          />
          {isDuplicate && (
            <span className="text-[9px] font-semibold text-text-light bg-border/50 px-1.5 py-px rounded shrink-0" title="A matching transaction already exists in the database">
              Exists
            </span>
          )}
          {showSourceFile && row.sourceFile && (
            <span className="text-[9px] text-text-light bg-surface-alt px-1.5 py-px rounded shrink-0 truncate max-w-[80px]" title={row.sourceFile}>
              {row.sourceFile.replace(/\.pdf$/i, "")}
            </span>
          )}
        </div>
      </td>
      <td className="p-2 text-right">
        <input
          type="number"
          value={row.amount}
          onChange={(e) =>
            onUpdate(index, { amount: Math.abs(Number(e.target.value) || 0) })
          }
          className="bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none text-xs w-20 text-right tabular-nums"
          step="0.01"
          min="0"
          disabled={disabled}
        />
      </td>
      <td className="p-2">
        <button
          type="button"
          onClick={() =>
            onUpdate(index, {
              type: row.type === "income" ? "expense" : "income",
              category_id: null,
              category: null,
            })
          }
          disabled={disabled}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
            row.type === "income"
              ? "bg-success/10 text-success"
              : "bg-danger/10 text-danger"
          }`}
        >
          {row.type === "income" ? "Income" : "Expense"}
        </button>
      </td>
      <td className="p-2">
        <CategoryCombo
          value={row.category_id ?? ""}
          onChange={(id) => onUpdate(index, { category_id: id || null })}
          categories={categories.filter((c) =>
            row.type === "income" ? c.is_income : !c.is_income,
          )}
          variant="edit"
          disabled={disabled}
          portal
        />
      </td>
      <td className="p-2">
        <button
          type="button"
          onClick={() => onRemove(index)}
          disabled={disabled}
          className="text-text-light hover:text-danger transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed p-0.5 rounded hover:bg-danger/5"
          title="Remove"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  );
}
