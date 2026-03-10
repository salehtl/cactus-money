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
    case "yearly": {
      const y = d.getFullYear() + 1;
      const m = d.getMonth();
      const anchor = anchorDay ?? d.getDate();
      const maxDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(anchor, maxDay);
      return formatLocalDate(new Date(y, m, day));
    }
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
