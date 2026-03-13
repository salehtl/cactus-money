import type { RecurringTransaction } from "../types/database.ts";

export function getNextOccurrence(
  current: string,
  frequency: RecurringTransaction["frequency"],
  anchorDay?: number | null,
  customDays?: number | null
): string {
  const d = new Date(current + "T00:00:00");

  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;
    case "monthly":
      return advanceMonths(d, 1, anchorDay);
    case "quarterly":
      return advanceMonths(d, 3, anchorDay);
    case "yearly":
      return advanceMonths(d, 12, anchorDay);
    case "custom":
      d.setDate(d.getDate() + (customDays ?? 1));
      break;
  }

  return formatLocalDate(d);
}

function advanceMonths(d: Date, months: number, anchorDay?: number | null): string {
  const m = d.getMonth() + months;
  const y = d.getFullYear();
  const anchor = anchorDay ?? d.getDate();
  const newDate = new Date(y, m, 1);
  const maxDay = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
  const day = Math.min(anchor, maxDay);
  return formatLocalDate(new Date(newDate.getFullYear(), newDate.getMonth(), day));
}

/** Format Date as YYYY-MM-DD using local timezone (NOT UTC) */
export function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert a per-occurrence amount to a monthly equivalent.
 * Used for recurring summary cards.
 */
export function monthlyEquivalent(
  amount: number,
  frequency: RecurringTransaction["frequency"],
  customDays?: number | null
): number {
  switch (frequency) {
    case "daily":
      return amount * 365.25 / 12;
    case "weekly":
      return amount * 52 / 12;
    case "biweekly":
      return amount * 26 / 12;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
    case "custom":
      return customDays ? amount * (365.25 / customDays) / 12 : amount;
  }
}

/**
 * Compute ALL occurrence dates for a recurring rule within [monthStart, monthEnd].
 * Returns an array of YYYY-MM-DD strings (may be empty).
 */
export function computeOccurrencesForMonth(
  rule: { frequency: RecurringTransaction["frequency"]; start_date: string; end_date: string | null; next_occurrence: string; anchor_day: number | null; custom_interval_days: number | null },
  monthStart: string,
  monthEnd: string
): string[] {
  const freq = rule.frequency;

  // For month-based frequencies with anchor_day, direct calculation (0 or 1 occurrence)
  if ((freq === "monthly" || freq === "quarterly" || freq === "yearly") && rule.anchor_day) {
    const [y, m] = monthStart.slice(0, 7).split("-").map(Number) as [number, number];
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(rule.anchor_day, maxDay);
    const occ = formatLocalDate(new Date(y, m - 1, day));

    if (freq === "quarterly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      if ((m - startMonth + 12) % 3 !== 0) return [];
    }
    if (freq === "yearly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      if (m !== startMonth) return [];
    }

    if (occ >= monthStart && occ <= monthEnd && occ >= rule.start_date) {
      if (rule.end_date && occ > rule.end_date) return [];
      return [occ];
    }
    return [];
  }

  // For day-based frequencies: iterate ALL occurrences within the month
  const results: string[] = [];
  let occ = rule.next_occurrence;

  // Step forward from next_occurrence until we reach the month
  while (occ < monthStart) {
    occ = getNextOccurrence(occ, freq, rule.anchor_day, rule.custom_interval_days);
    if (rule.end_date && occ > rule.end_date) return [];
  }

  // Collect all occurrences within the month
  while (occ <= monthEnd) {
    if (occ >= rule.start_date) {
      if (rule.end_date && occ > rule.end_date) break;
      results.push(occ);
    }
    occ = getNextOccurrence(occ, freq, rule.anchor_day, rule.custom_interval_days);
  }

  return results;
}

export function formatFrequency(
  frequency: RecurringTransaction["frequency"],
  customDays?: number | null
): string {
  switch (frequency) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "yearly":
      return "Yearly";
    case "custom":
      return `Every ${customDays} days`;
  }
}
