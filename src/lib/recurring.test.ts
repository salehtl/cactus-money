import {
  getNextOccurrence,
  formatLocalDate,
  monthlyEquivalent,
  computeOccurrencesForMonth,
  formatFrequency,
} from "./recurring";

// ---------------------------------------------------------------------------
// getNextOccurrence
// ---------------------------------------------------------------------------

describe("getNextOccurrence", () => {
  describe("daily", () => {
    it("advances by one day", () => {
      expect(getNextOccurrence("2026-03-10", "daily")).toBe("2026-03-11");
    });

    it("crosses month boundary", () => {
      expect(getNextOccurrence("2026-03-31", "daily")).toBe("2026-04-01");
    });

    it("crosses year boundary", () => {
      expect(getNextOccurrence("2025-12-31", "daily")).toBe("2026-01-01");
    });
  });

  describe("weekly", () => {
    it("advances by 7 days", () => {
      expect(getNextOccurrence("2026-03-10", "weekly")).toBe("2026-03-17");
    });

    it("crosses month boundary", () => {
      expect(getNextOccurrence("2026-03-28", "weekly")).toBe("2026-04-04");
    });
  });

  describe("biweekly", () => {
    it("advances by 14 days", () => {
      expect(getNextOccurrence("2026-03-01", "biweekly")).toBe("2026-03-15");
    });

    it("crosses month boundary", () => {
      expect(getNextOccurrence("2026-03-25", "biweekly")).toBe("2026-04-08");
    });
  });

  describe("monthly", () => {
    it("advances by one month", () => {
      expect(getNextOccurrence("2026-01-15", "monthly")).toBe("2026-02-15");
    });

    it("clamps to end of shorter month (Jan 31 → Feb 28)", () => {
      expect(getNextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    });

    it("clamps to Feb 29 in leap year", () => {
      expect(getNextOccurrence("2028-01-31", "monthly")).toBe("2028-02-29");
    });

    it("respects anchor_day", () => {
      // Start on the 28th but anchor is 31 → next month should clamp to month max
      expect(getNextOccurrence("2026-01-28", "monthly", 31)).toBe("2026-02-28");
    });

    it("anchor_day restores original day after short month", () => {
      // Feb 28 with anchor 31 → Mar 31
      expect(getNextOccurrence("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    });

    it("crosses year boundary", () => {
      expect(getNextOccurrence("2025-12-15", "monthly")).toBe("2026-01-15");
    });
  });

  describe("quarterly", () => {
    it("advances by 3 months", () => {
      expect(getNextOccurrence("2026-01-15", "quarterly")).toBe("2026-04-15");
    });

    it("clamps day for shorter target month", () => {
      // Jan 31 + 3 months → Apr 30
      expect(getNextOccurrence("2026-01-31", "quarterly")).toBe("2026-04-30");
    });

    it("crosses year boundary", () => {
      expect(getNextOccurrence("2025-11-15", "quarterly")).toBe("2026-02-15");
    });

    it("respects anchor_day across quarter", () => {
      expect(getNextOccurrence("2026-01-15", "quarterly", 31)).toBe("2026-04-30");
    });
  });

  describe("yearly", () => {
    it("advances by 12 months", () => {
      expect(getNextOccurrence("2026-03-15", "yearly")).toBe("2027-03-15");
    });

    it("leap year Feb 29 → non-leap year Feb 28", () => {
      expect(getNextOccurrence("2028-02-29", "yearly")).toBe("2029-02-28");
    });

    it("restores anchor_day when target year has leap day", () => {
      expect(getNextOccurrence("2027-02-28", "yearly", 29)).toBe("2028-02-29");
    });
  });

  describe("custom", () => {
    it("advances by custom_days", () => {
      expect(getNextOccurrence("2026-03-01", "custom", null, 10)).toBe("2026-03-11");
    });

    it("defaults to 1 day when customDays is null", () => {
      expect(getNextOccurrence("2026-03-10", "custom", null, null)).toBe("2026-03-11");
    });

    it("handles large custom intervals crossing months", () => {
      expect(getNextOccurrence("2026-03-01", "custom", null, 45)).toBe("2026-04-15");
    });
  });
});

// ---------------------------------------------------------------------------
// formatLocalDate
// ---------------------------------------------------------------------------

describe("formatLocalDate", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(formatLocalDate(new Date(2026, 2, 10))).toBe("2026-03-10");
  });

  it("zero-pads single-digit months", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("zero-pads single-digit days", () => {
    expect(formatLocalDate(new Date(2026, 8, 3))).toBe("2026-09-03");
  });
});

// ---------------------------------------------------------------------------
// monthlyEquivalent
// ---------------------------------------------------------------------------

describe("monthlyEquivalent", () => {
  const amount = 120;

  it("daily: amount * 365.25 / 12", () => {
    expect(monthlyEquivalent(amount, "daily")).toBeCloseTo(120 * 365.25 / 12);
  });

  it("weekly: amount * 52 / 12", () => {
    expect(monthlyEquivalent(amount, "weekly")).toBeCloseTo(120 * 52 / 12);
  });

  it("biweekly: amount * 26 / 12", () => {
    expect(monthlyEquivalent(amount, "biweekly")).toBeCloseTo(120 * 26 / 12);
  });

  it("monthly: same amount", () => {
    expect(monthlyEquivalent(amount, "monthly")).toBe(120);
  });

  it("quarterly: amount / 3", () => {
    expect(monthlyEquivalent(amount, "quarterly")).toBeCloseTo(40);
  });

  it("yearly: amount / 12", () => {
    expect(monthlyEquivalent(amount, "yearly")).toBeCloseTo(10);
  });

  it("custom with customDays", () => {
    // Every 10 days → 365.25/10 times per year → / 12 for monthly
    expect(monthlyEquivalent(100, "custom", 10)).toBeCloseTo(100 * (365.25 / 10) / 12);
  });

  it("custom without customDays falls back to amount", () => {
    expect(monthlyEquivalent(100, "custom", null)).toBe(100);
    expect(monthlyEquivalent(100, "custom", 0)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// computeOccurrencesForMonth
// ---------------------------------------------------------------------------

describe("computeOccurrencesForMonth", () => {
  const baseRule = {
    frequency: "monthly" as const,
    start_date: "2026-01-15",
    end_date: null,
    next_occurrence: "2026-01-15",
    anchor_day: 15,
    custom_interval_days: null,
  };

  describe("monthly with anchor_day", () => {
    it("returns one occurrence in the right month", () => {
      const result = computeOccurrencesForMonth(baseRule, "2026-03-01", "2026-03-31");
      expect(result).toEqual(["2026-03-15"]);
    });

    it("returns empty before start_date", () => {
      const result = computeOccurrencesForMonth(baseRule, "2025-12-01", "2025-12-31");
      expect(result).toEqual([]);
    });

    it("clamps anchor_day to month max (31st in Feb)", () => {
      const rule = { ...baseRule, anchor_day: 31, start_date: "2026-01-31" };
      const result = computeOccurrencesForMonth(rule, "2026-02-01", "2026-02-28");
      expect(result).toEqual(["2026-02-28"]);
    });

    it("returns Feb 29 in leap year for anchor_day 29", () => {
      const rule = { ...baseRule, anchor_day: 29, start_date: "2028-01-29" };
      const result = computeOccurrencesForMonth(rule, "2028-02-01", "2028-02-29");
      expect(result).toEqual(["2028-02-29"]);
    });

    it("respects end_date", () => {
      const rule = { ...baseRule, end_date: "2026-02-28" };
      const result = computeOccurrencesForMonth(rule, "2026-03-01", "2026-03-31");
      expect(result).toEqual([]);
    });
  });

  describe("quarterly with anchor_day", () => {
    const qRule = {
      ...baseRule,
      frequency: "quarterly" as const,
      start_date: "2026-01-15",
      anchor_day: 15,
    };

    it("returns occurrence in the correct quarter month", () => {
      // Jan start → occurrences in Jan, Apr, Jul, Oct
      const result = computeOccurrencesForMonth(qRule, "2026-04-01", "2026-04-30");
      expect(result).toEqual(["2026-04-15"]);
    });

    it("returns empty for non-quarter month", () => {
      const result = computeOccurrencesForMonth(qRule, "2026-02-01", "2026-02-28");
      expect(result).toEqual([]);
    });

    it("returns empty for off-cycle month", () => {
      const result = computeOccurrencesForMonth(qRule, "2026-03-01", "2026-03-31");
      expect(result).toEqual([]);
    });
  });

  describe("yearly with anchor_day", () => {
    const yRule = {
      ...baseRule,
      frequency: "yearly" as const,
      start_date: "2026-03-15",
      anchor_day: 15,
    };

    it("returns occurrence in the anniversary month", () => {
      const result = computeOccurrencesForMonth(yRule, "2027-03-01", "2027-03-31");
      expect(result).toEqual(["2027-03-15"]);
    });

    it("returns empty for non-anniversary month", () => {
      const result = computeOccurrencesForMonth(yRule, "2027-06-01", "2027-06-30");
      expect(result).toEqual([]);
    });
  });

  describe("weekly (day-based iteration)", () => {
    const wRule = {
      frequency: "weekly" as const,
      start_date: "2026-03-02",  // Monday
      end_date: null,
      next_occurrence: "2026-03-02",
      anchor_day: null,
      custom_interval_days: null,
    };

    it("returns all weekly occurrences in a month", () => {
      const result = computeOccurrencesForMonth(wRule, "2026-03-01", "2026-03-31");
      // Mar 2, 9, 16, 23, 30
      expect(result).toEqual([
        "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30",
      ]);
    });

    it("returns occurrences in a future month", () => {
      const result = computeOccurrencesForMonth(wRule, "2026-04-01", "2026-04-30");
      // Next after Mar 30 = Apr 6, 13, 20, 27
      expect(result).toEqual([
        "2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27",
      ]);
    });

    it("respects end_date mid-month", () => {
      const rule = { ...wRule, end_date: "2026-03-20" };
      const result = computeOccurrencesForMonth(rule, "2026-03-01", "2026-03-31");
      expect(result).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    });
  });

  describe("daily", () => {
    const dRule = {
      frequency: "daily" as const,
      start_date: "2026-03-28",
      end_date: null,
      next_occurrence: "2026-03-28",
      anchor_day: null,
      custom_interval_days: null,
    };

    it("returns daily occurrences from start through month end", () => {
      const result = computeOccurrencesForMonth(dRule, "2026-03-01", "2026-03-31");
      // 28, 29, 30, 31
      expect(result).toHaveLength(4);
      expect(result[0]).toBe("2026-03-28");
      expect(result[3]).toBe("2026-03-31");
    });

    it("returns all days of April for a daily rule starting before", () => {
      const rule = { ...dRule, start_date: "2026-03-01", next_occurrence: "2026-03-01" };
      const result = computeOccurrencesForMonth(rule, "2026-04-01", "2026-04-30");
      expect(result).toHaveLength(30);
    });
  });

  describe("biweekly", () => {
    const bRule = {
      frequency: "biweekly" as const,
      start_date: "2026-03-01",
      end_date: null,
      next_occurrence: "2026-03-01",
      anchor_day: null,
      custom_interval_days: null,
    };

    it("returns biweekly occurrences", () => {
      const result = computeOccurrencesForMonth(bRule, "2026-03-01", "2026-03-31");
      // Mar 1, 15, 29
      expect(result).toEqual(["2026-03-01", "2026-03-15", "2026-03-29"]);
    });
  });

  describe("custom interval", () => {
    const cRule = {
      frequency: "custom" as const,
      start_date: "2026-03-01",
      end_date: null,
      next_occurrence: "2026-03-01",
      anchor_day: null,
      custom_interval_days: 10,
    };

    it("returns occurrences every 10 days", () => {
      const result = computeOccurrencesForMonth(cRule, "2026-03-01", "2026-03-31");
      // Mar 1, 11, 21, 31
      expect(result).toEqual(["2026-03-01", "2026-03-11", "2026-03-21", "2026-03-31"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty for month-based rule without anchor_day (falls through to iteration)", () => {
      const rule = {
        frequency: "monthly" as const,
        start_date: "2026-01-15",
        end_date: null,
        next_occurrence: "2026-01-15",
        anchor_day: null,
        custom_interval_days: null,
      };
      // Without anchor_day, monthly uses iteration path
      const result = computeOccurrencesForMonth(rule, "2026-03-01", "2026-03-31");
      expect(result).toEqual(["2026-03-15"]);
    });

    it("start_date in the middle of the queried month", () => {
      const rule = {
        frequency: "daily" as const,
        start_date: "2026-03-15",
        end_date: null,
        next_occurrence: "2026-03-15",
        anchor_day: null,
        custom_interval_days: null,
      };
      const result = computeOccurrencesForMonth(rule, "2026-03-01", "2026-03-31");
      expect(result).toHaveLength(17); // 15th through 31st
      expect(result[0]).toBe("2026-03-15");
    });
  });
});

// ---------------------------------------------------------------------------
// formatFrequency
// ---------------------------------------------------------------------------

describe("formatFrequency", () => {
  it("returns Daily", () => expect(formatFrequency("daily")).toBe("Daily"));
  it("returns Weekly", () => expect(formatFrequency("weekly")).toBe("Weekly"));
  it("returns Every 2 weeks", () => expect(formatFrequency("biweekly")).toBe("Every 2 weeks"));
  it("returns Monthly", () => expect(formatFrequency("monthly")).toBe("Monthly"));
  it("returns Quarterly", () => expect(formatFrequency("quarterly")).toBe("Quarterly"));
  it("returns Yearly", () => expect(formatFrequency("yearly")).toBe("Yearly"));
  it("returns custom interval", () => expect(formatFrequency("custom", 5)).toBe("Every 5 days"));
  it("handles undefined customDays", () => expect(formatFrequency("custom")).toBe("Every undefined days"));
});
