const currencyFormatter = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-AE", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateShort(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-AE", {
    month: "short",
    day: "numeric",
  });
}

export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return new Date(Number(year), Number(m) - 1).toLocaleDateString("en-AE", {
    month: "long",
    year: "numeric",
  });
}

export function getCurrentMonth(): string {
  return getToday().slice(0, 7);
}

export function getPreviousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(year, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getNextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(year, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Default timezone for the app (UAE) */
export const DEFAULT_TIMEZONE = "Asia/Dubai";

let _timezone: string = DEFAULT_TIMEZONE;

/** Set the app timezone (called from settings on load) */
export function setAppTimezone(tz: string): void {
  _timezone = tz;
}

/** Get the current app timezone */
export function getAppTimezone(): string {
  return _timezone;
}

/**
 * Returns today's date as YYYY-MM-DD in the configured timezone.
 * Uses Intl.DateTimeFormat to get the correct local date regardless of UTC offset.
 */
export function getToday(tz?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz ?? _timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}
