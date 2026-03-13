import { normalizePayee, diceCoefficient, detectRecurringPatterns } from "./detect-recurring.ts";

// Helper to build a minimal transaction
function txn(
  payee: string,
  date: string,
  amount: number,
  type: "income" | "expense" = "expense",
  opts: { category_id?: string; category?: string; selected?: boolean; duplicate?: boolean } = {},
) {
  return {
    date,
    payee,
    amount,
    type,
    category: opts.category ?? null,
    category_id: opts.category_id ?? null,
    selected: opts.selected ?? true,
    duplicate: opts.duplicate ?? false,
  };
}

// --- normalizePayee ---

describe("normalizePayee", () => {
  it("lowercases", () => {
    expect(normalizePayee("ETISALAT")).toBe("etisalat");
  });

  it("strips sequences of 4+ digits", () => {
    expect(normalizePayee("POS 123456 STORE")).toBe("pos store");
  });

  it("keeps short digit sequences", () => {
    expect(normalizePayee("DU 123 BILL")).toBe("du 123 bill");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizePayee("  ETISALAT   BILL   PAY  ")).toBe("etisalat bill pay");
  });

  it("handles combined normalization", () => {
    expect(normalizePayee("POS 0012345678 CARREFOUR   DUBAI")).toBe("pos carrefour dubai");
  });
});

// --- diceCoefficient ---

describe("diceCoefficient", () => {
  it("returns 1.0 for identical strings", () => {
    expect(diceCoefficient("etisalat", "etisalat")).toBe(1.0);
  });

  it("returns 0 for single-char strings", () => {
    expect(diceCoefficient("a", "b")).toBe(0);
  });

  it("returns high score for similar strings", () => {
    const score = diceCoefficient("etisalat bill pay", "etisalat billpay");
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it("returns low score for different strings", () => {
    const score = diceCoefficient("etisalat", "carrefour");
    expect(score).toBeLessThan(0.5);
  });

  it("handles empty strings", () => {
    expect(diceCoefficient("", "abc")).toBe(0);
    expect(diceCoefficient("abc", "")).toBe(0);
  });
});

// --- detectRecurringPatterns ---

describe("detectRecurringPatterns", () => {
  it("detects 3 monthly same-payee transactions", () => {
    const txns = [
      txn("ETISALAT", "2026-01-15", 245),
      txn("ETISALAT", "2026-02-15", 245),
      txn("ETISALAT", "2026-03-15", 245),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("monthly");
    expect(result[0]!.confidence).toBe("high");
    expect(result[0]!.selected).toBe(true);
    expect(result[0]!.averageAmount).toBe(245);
    expect(result[0]!.isVariable).toBe(false);
    expect(result[0]!.anchorDay).toBe(15);
    expect(result[0]!.occurrences).toHaveLength(3);
  });

  it("detects 4 weekly transactions", () => {
    const txns = [
      txn("GYM", "2026-01-05", 50),
      txn("GYM", "2026-01-12", 50),
      txn("GYM", "2026-01-19", 50),
      txn("GYM", "2026-01-26", 50),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("weekly");
    expect(result[0]!.confidence).toBe("high");
  });

  it("detects 2 biweekly as medium confidence", () => {
    const txns = [
      txn("CLEANING", "2026-01-01", 150),
      txn("CLEANING", "2026-01-15", 150),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("biweekly");
    expect(result[0]!.confidence).toBe("medium");
    expect(result[0]!.selected).toBe(false);
  });

  it("detects multiple candidates from different payees", () => {
    const txns = [
      txn("ETISALAT", "2026-01-15", 245),
      txn("ETISALAT", "2026-02-15", 245),
      txn("ETISALAT", "2026-03-15", 245),
      txn("NETFLIX", "2026-01-03", 49),
      txn("NETFLIX", "2026-02-03", 49),
      txn("NETFLIX", "2026-03-03", 49),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.payee).sort()).toEqual(["ETISALAT", "NETFLIX"]);
  });

  it("marks variable amounts when max/min > 1.10", () => {
    const txns = [
      txn("DU MOBILE", "2026-01-10", 200),
      txn("DU MOBILE", "2026-02-10", 250),
      txn("DU MOBILE", "2026-03-10", 230),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.isVariable).toBe(true);
    expect(result[0]!.averageAmount).toBeCloseTo(226.67, 1);
  });

  it("returns empty for single occurrence", () => {
    const txns = [txn("RANDOM SHOP", "2026-01-15", 100)];
    expect(detectRecurringPatterns(txns)).toHaveLength(0);
  });

  it("returns empty when all payees are different", () => {
    const txns = [
      txn("CARREFOUR MALL", "2026-01-15", 100),
      txn("ETISALAT BILL", "2026-02-15", 200),
      txn("NETFLIX STREAMING", "2026-03-15", 300),
    ];
    expect(detectRecurringPatterns(txns)).toHaveLength(0);
  });

  it("clusters similar payee variations together", () => {
    const txns = [
      txn("ETISALAT BILL PAY", "2026-01-15", 245),
      txn("ETISALAT BILLPAY", "2026-02-15", 245),
      txn("ETISALAT BILL PAY", "2026-03-15", 245),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toHaveLength(3);
  });

  it("skips deselected transactions", () => {
    const txns = [
      txn("ETISALAT", "2026-01-15", 245, "expense", { selected: false }),
      txn("ETISALAT", "2026-02-15", 245),
      txn("ETISALAT", "2026-03-15", 245),
    ];

    const result = detectRecurringPatterns(txns);
    // Only 2 selected → medium confidence (still detected as biweekly-ish or monthly)
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toHaveLength(2);
  });

  it("skips duplicate transactions", () => {
    const txns = [
      txn("ETISALAT", "2026-01-15", 245, "expense", { duplicate: true }),
      txn("ETISALAT", "2026-02-15", 245),
      txn("ETISALAT", "2026-03-15", 245),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toHaveLength(2);
  });

  it("separates income and expense even with same payee", () => {
    const txns = [
      txn("COMPANY X", "2026-01-01", 5000, "income"),
      txn("COMPANY X", "2026-02-01", 5000, "income"),
      txn("COMPANY X", "2026-03-01", 5000, "income"),
      txn("COMPANY X", "2026-01-15", 100, "expense"),
      txn("COMPANY X", "2026-02-15", 100, "expense"),
      txn("COMPANY X", "2026-03-15", 100, "expense"),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(2);
    const income = result.find((r) => r.type === "income");
    const expense = result.find((r) => r.type === "expense");
    expect(income).toBeDefined();
    expect(expense).toBeDefined();
    expect(income!.averageAmount).toBe(5000);
    expect(expense!.averageAmount).toBe(100);
  });

  it("skips groups with irregular intervals", () => {
    const txns = [
      txn("RANDOM", "2026-01-01", 100),
      txn("RANDOM", "2026-01-05", 100),
      txn("RANDOM", "2026-02-20", 100),
    ];

    // Intervals: 4 days, 46 days — median 25, doesn't match any frequency
    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(0);
  });

  it("computes nextOccurrence from last date", () => {
    const txns = [
      txn("RENT", "2026-01-01", 5000),
      txn("RENT", "2026-02-01", 5000),
      txn("RENT", "2026-03-01", 5000),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.nextOccurrence).toBe("2026-04-01");
  });

  it("carries category from any occurrence that has one", () => {
    const txns = [
      txn("ETISALAT", "2026-01-15", 245, "expense", { category_id: "cat-1", category: "Utilities" }),
      txn("ETISALAT", "2026-02-15", 245),
      txn("ETISALAT", "2026-03-15", 245),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result[0]!.category_id).toBe("cat-1");
    expect(result[0]!.category).toBe("Utilities");
  });

  it("detects quarterly pattern", () => {
    const txns = [
      txn("INSURANCE", "2026-01-15", 1200),
      txn("INSURANCE", "2026-04-15", 1200),
      txn("INSURANCE", "2026-07-15", 1200),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("quarterly");
    expect(result[0]!.anchorDay).toBe(15);
  });

  it("detects yearly pattern", () => {
    const txns = [
      txn("ANNUAL LICENSE", "2024-03-01", 3600),
      txn("ANNUAL LICENSE", "2025-03-01", 3600),
      txn("ANNUAL LICENSE", "2026-03-01", 3600),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("yearly");
  });

  it("strips digit sequences when clustering payees", () => {
    const txns = [
      txn("POS 1234567 CARREFOUR", "2026-01-07", 300),
      txn("POS 9876543 CARREFOUR", "2026-01-14", 310),
      txn("POS 5555555 CARREFOUR", "2026-01-21", 290),
      txn("POS 1111111 CARREFOUR", "2026-01-28", 305),
    ];

    const result = detectRecurringPatterns(txns);
    expect(result).toHaveLength(1);
    expect(result[0]!.inferredFrequency).toBe("weekly");
  });
});
