import {
  formatCurrency,
  formatDate,
  formatDateShort,
  formatMonth,
  getCurrentMonth,
  getPreviousMonth,
  getNextMonth,
  getToday,
} from "./format";

describe("formatCurrency", () => {
  it("formats a positive amount with AED", () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain("1,234.56");
    expect(result).toContain("AED");
  });

  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0.00");
    expect(result).toContain("AED");
  });

  it("formats small decimals with two fraction digits", () => {
    const result = formatCurrency(0.1);
    expect(result).toContain("0.10");
  });

  it("formats negative amounts", () => {
    const result = formatCurrency(-500);
    expect(result).toContain("500.00");
  });
});

describe("formatDate", () => {
  it("formats a valid date string with weekday, month, day, and year", () => {
    const result = formatDate("2026-03-10");
    expect(result).toMatch(/Tue/);
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/10/);
    expect(result).toMatch(/2026/);
  });
});

describe("formatDateShort", () => {
  it("formats a valid date string with month and day only", () => {
    const result = formatDateShort("2026-03-10");
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/10/);
    // Should not include the year
    expect(result).not.toMatch(/2026/);
  });
});

describe("formatMonth", () => {
  it("formats YYYY-MM to full month and year", () => {
    const result = formatMonth("2026-03");
    expect(result).toMatch(/March/);
    expect(result).toMatch(/2026/);
  });

  it("handles December edge case", () => {
    const result = formatMonth("2025-12");
    expect(result).toMatch(/December/);
    expect(result).toMatch(/2025/);
  });

  it("handles January", () => {
    const result = formatMonth("2026-01");
    expect(result).toMatch(/January/);
    expect(result).toMatch(/2026/);
  });
});

describe("getCurrentMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a string in YYYY-MM format", () => {
    const result = getCurrentMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it("returns the correct month for a pinned date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    expect(getCurrentMonth()).toBe("2026-03");
    vi.useRealTimers();
  });
});

describe("getPreviousMonth", () => {
  it("returns the previous month for a normal case", () => {
    expect(getPreviousMonth("2026-03")).toBe("2026-02");
  });

  it("wraps across year boundary (2026-01 -> 2025-12)", () => {
    expect(getPreviousMonth("2026-01")).toBe("2025-12");
  });
});

describe("getNextMonth", () => {
  it("returns the next month for a normal case", () => {
    expect(getNextMonth("2026-03")).toBe("2026-04");
  });

  it("wraps across year boundary (2025-12 -> 2026-01)", () => {
    expect(getNextMonth("2025-12")).toBe("2026-01");
  });
});

describe("getToday", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a string in YYYY-MM-DD format", () => {
    const result = getToday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the correct date for a pinned time in UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    expect(getToday("UTC")).toBe("2026-03-15");
    vi.useRealTimers();
  });

  it("returns the correct date at midnight UTC when Dubai is already the next day", () => {
    vi.useFakeTimers();
    // Midnight UTC = 4:00 AM Dubai time (already March 15)
    vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));
    expect(getToday("Asia/Dubai")).toBe("2026-03-15");
    vi.useRealTimers();
  });

  it("returns next day for Dubai when UTC is still previous day evening", () => {
    vi.useFakeTimers();
    // 21:00 UTC = 01:00 AM next day in Dubai
    vi.setSystemTime(new Date("2026-03-14T21:00:00Z"));
    expect(getToday("Asia/Dubai")).toBe("2026-03-15");
    expect(getToday("UTC")).toBe("2026-03-14");
    vi.useRealTimers();
  });
});
