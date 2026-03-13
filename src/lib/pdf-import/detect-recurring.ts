import { getNextOccurrence } from "../recurring.ts";
import { ANCHOR_DAY_FREQUENCIES } from "../../db/schema.ts";

export interface RecurringCandidate {
  id: string;
  payee: string;
  normalizedPayee: string;
  type: "income" | "expense";
  category_id: string | null;
  category: string | null;
  occurrences: { date: string; amount: number }[];
  inferredFrequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  averageAmount: number;
  isVariable: boolean;
  confidence: "high" | "medium";
  startDate: string;
  nextOccurrence: string;
  anchorDay: number | null;
  selected: boolean;
  existingRuleWarning?: string;
}

type TxnLike = {
  date: string;
  payee: string;
  amount: number;
  type: "income" | "expense";
  category: string | null;
  category_id: string | null;
  selected: boolean;
  duplicate?: boolean;
};

/** Normalize payee for comparison: lowercase, strip 4+ digit sequences, collapse whitespace */
export function normalizePayee(payee: string): string {
  return payee
    .toLowerCase()
    .replace(/\d{4,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient (bigram overlap) between two strings. Returns 0–1. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bi = s.slice(i, i + 2);
      map.set(bi, (map.get(bi) ?? 0) + 1);
    }
    return map;
  };

  const biA = bigrams(a);
  const biB = bigrams(b);
  let intersection = 0;
  for (const [bi, countA] of biA) {
    const countB = biB.get(bi) ?? 0;
    intersection += Math.min(countA, countB);
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

type Frequency = RecurringCandidate["inferredFrequency"];

const FREQUENCY_RANGES: [number, number, Frequency][] = [
  [6, 8, "weekly"],
  [13, 16, "biweekly"],
  [27, 33, "monthly"],
  [85, 100, "quarterly"],
  [350, 380, "yearly"],
];

function medianIntervalToFrequency(medianDays: number): Frequency | null {
  for (const [lo, hi, freq] of FREQUENCY_RANGES) {
    if (medianDays >= lo && medianDays <= hi) return freq;
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mostCommonDayOfMonth(dates: string[]): number {
  const counts = new Map<number, number>();
  for (const d of dates) {
    const day = parseInt(d.slice(8, 10), 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best = 1, bestCount = 0;
  for (const [day, count] of counts) {
    if (count > bestCount) { best = day; bestCount = count; }
  }
  return best;
}

/**
 * Detect recurring patterns among parsed transactions.
 * Pure function — no DB or React dependencies.
 */
export function detectRecurringPatterns(txns: TxnLike[]): RecurringCandidate[] {
  // 1. Filter to selected, non-duplicate transactions
  const eligible = txns.filter((t) => t.selected && !t.duplicate);
  if (eligible.length < 2) return [];

  // 2. Group by type, then by normalized payee (fuzzy)
  const groups: Map<string, TxnLike[]> = new Map();

  for (const t of eligible) {
    const norm = normalizePayee(t.payee);
    const key = `${t.type}::${norm}`;

    // Try to find an existing group with Dice >= 0.8
    let matched = false;
    for (const [gKey, gTxns] of groups) {
      if (!gKey.startsWith(t.type + "::")) continue;
      const gNorm = gKey.slice(t.type.length + 2);
      if (diceCoefficient(norm, gNorm) >= 0.8) {
        gTxns.push(t);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(key, [t]);
    }
  }

  // 3. Process each group
  const candidates: RecurringCandidate[] = [];

  for (const [, txnGroup] of groups) {
    if (txnGroup.length < 2) continue;

    // Sort by date
    const sorted = [...txnGroup].sort((a, b) => a.date.localeCompare(b.date));

    // Compute consecutive intervals in days
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1]!.date + "T00:00:00").getTime();
      const d2 = new Date(sorted[i]!.date + "T00:00:00").getTime();
      intervals.push(Math.round((d2 - d1) / 86400000));
    }

    if (intervals.length === 0) continue;

    // Map median interval to frequency
    const medianInterval = median(intervals);
    const freq = medianIntervalToFrequency(medianInterval);
    if (!freq) continue;

    // Confidence
    const confidence: "high" | "medium" = sorted.length >= 3 ? "high" : "medium";

    // Variable amount check
    const amounts = sorted.map((t) => t.amount);
    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    const isVariable = minAmt > 0 && maxAmt / minAmt > 1.10;
    const averageAmount = Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length * 100) / 100;

    // Anchor day for monthly/quarterly/yearly
    const dates = sorted.map((t) => t.date);
    const anchorDay = (ANCHOR_DAY_FREQUENCIES as readonly string[]).includes(freq)
      ? mostCommonDayOfMonth(dates)
      : null;

    // Start date and next occurrence
    const startDate = sorted[0]!.date;
    const lastDate = sorted[sorted.length - 1]!.date;
    const nextOccurrence = getNextOccurrence(lastDate, freq, anchorDay);

    // Use earliest occurrence's payee as representative
    const representativePayee = sorted[0]!.payee;
    // Use category from any transaction that has one
    const withCat = sorted.find((t) => t.category_id);

    candidates.push({
      id: crypto.randomUUID(),
      payee: representativePayee,
      normalizedPayee: normalizePayee(representativePayee),
      type: sorted[0]!.type,
      category_id: withCat?.category_id ?? null,
      category: withCat?.category ?? null,
      occurrences: sorted.map((t) => ({ date: t.date, amount: t.amount })),
      inferredFrequency: freq,
      averageAmount,
      isVariable,
      confidence,
      startDate,
      nextOccurrence,
      anchorDay,
      selected: confidence === "high",
    });
  }

  // Sort: high confidence first, then by payee
  candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return a.payee.localeCompare(b.payee);
  });

  return candidates;
}
