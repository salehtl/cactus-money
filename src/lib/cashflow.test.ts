import { buildCashflowRows, type GroupBy } from "./cashflow";
import type { TransactionWithCategory } from "../db/queries/transactions";

function makeTxn(overrides: Partial<TransactionWithCategory> = {}): TransactionWithCategory {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    amount: overrides.amount ?? 100,
    type: overrides.type ?? "expense",
    category_id: "category_id" in overrides ? overrides.category_id! : "cat-1",
    date: overrides.date ?? "2026-03-15",
    payee: "payee" in overrides ? overrides.payee! : "Test Payee",
    notes: overrides.notes ?? "",
    recurring_id: overrides.recurring_id ?? null,
    status: overrides.status ?? "confirmed",
    group_name: "group_name" in overrides ? overrides.group_name! : "",
    created_at: "2026-03-10T00:00:00",
    updated_at: "2026-03-10T00:00:00",
    category_name: "category_name" in overrides ? overrides.category_name! : "Food",
    category_color: overrides.category_color ?? "#ff0000",
    category_icon: overrides.category_icon ?? "",
    recurring_frequency: overrides.recurring_frequency ?? null,
  } as TransactionWithCategory;
}

// ---------------------------------------------------------------------------
// Row transformation
// ---------------------------------------------------------------------------

describe("buildCashflowRows — row mapping", () => {
  it("maps transaction fields to CashflowRow", () => {
    const txn = makeTxn({
      payee: "Salary",
      type: "income",
      amount: 5000,
      status: "confirmed",
      recurring_id: "rec-1",
      recurring_frequency: "monthly",
      category_name: "Employment",
      category_color: "#00ff00",
      group_name: "Job",
    });

    const { incomeGroups } = buildCashflowRows([txn]);
    const row = incomeGroups[0]!.rows[0]!;

    expect(row.label).toBe("Salary");
    expect(row.type).toBe("income");
    expect(row.amount).toBe(5000);
    expect(row.status).toBe("confirmed");
    expect(row.isRecurring).toBe(true);
    expect(row.recurringId).toBe("rec-1");
    expect(row.frequency).toBe("monthly");
    expect(row.categoryName).toBe("Employment");
    expect(row.categoryColor).toBe("#00ff00");
    expect(row.groupName).toBe("Job");
  });

  it("uses category_name as label when payee is empty", () => {
    const txn = makeTxn({ payee: "", category_name: "Groceries" });
    const { expenseGroups } = buildCashflowRows([txn]);
    expect(expenseGroups[0]!.rows[0]!.label).toBe("Groceries");
  });

  it('uses "Uncategorized" when both payee and category_name are empty', () => {
    const txn = makeTxn({ payee: "", category_name: null });
    const { expenseGroups } = buildCashflowRows([txn]);
    expect(expenseGroups[0]!.rows[0]!.label).toBe("Uncategorized");
  });

  it("marks non-recurring rows correctly", () => {
    const txn = makeTxn({ recurring_id: null, recurring_frequency: null });
    const { expenseGroups } = buildCashflowRows([txn]);
    const row = expenseGroups[0]!.rows[0]!;
    expect(row.isRecurring).toBe(false);
    expect(row.recurringId).toBeNull();
    expect(row.frequency).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Summary calculations
// ---------------------------------------------------------------------------

describe("buildCashflowRows — summary", () => {
  it("computes income, expenses, and net", () => {
    const txns = [
      makeTxn({ type: "income", amount: 5000 }),
      makeTxn({ type: "income", amount: 3000 }),
      makeTxn({ type: "expense", amount: 1500 }),
      makeTxn({ type: "expense", amount: 500 }),
    ];

    const { summary } = buildCashflowRows(txns);
    expect(summary.income).toBe(8000);
    expect(summary.expenses).toBe(2000);
    expect(summary.net).toBe(6000);
  });

  it("splits planned vs confirmed for income", () => {
    const txns = [
      makeTxn({ type: "income", amount: 5000, status: "confirmed" }),
      makeTxn({ type: "income", amount: 2000, status: "planned" }),
    ];

    const { summary } = buildCashflowRows(txns);
    expect(summary.confirmedIncome).toBe(5000);
    expect(summary.plannedIncome).toBe(2000);
    expect(summary.income).toBe(7000);
  });

  it("splits planned vs confirmed for expenses", () => {
    const txns = [
      makeTxn({ type: "expense", amount: 800, status: "confirmed" }),
      makeTxn({ type: "expense", amount: 200, status: "planned" }),
    ];

    const { summary } = buildCashflowRows(txns);
    expect(summary.confirmedExpenses).toBe(800);
    expect(summary.plannedExpenses).toBe(200);
  });

  it('treats "review" status as confirmed in summary', () => {
    const txns = [
      makeTxn({ type: "expense", amount: 300, status: "review" }),
    ];

    const { summary } = buildCashflowRows(txns);
    // "review" is not "planned", so it goes to confirmed
    expect(summary.confirmedExpenses).toBe(300);
    expect(summary.plannedExpenses).toBe(0);
  });

  it("handles empty transaction list", () => {
    const { summary, incomeGroups, expenseGroups } = buildCashflowRows([]);
    expect(summary.income).toBe(0);
    expect(summary.expenses).toBe(0);
    expect(summary.net).toBe(0);
    expect(incomeGroups).toEqual([]);
    expect(expenseGroups).toEqual([]);
  });

  it("handles all-income transactions", () => {
    const txns = [
      makeTxn({ type: "income", amount: 1000 }),
    ];

    const { summary, expenseGroups } = buildCashflowRows(txns);
    expect(summary.income).toBe(1000);
    expect(summary.expenses).toBe(0);
    expect(summary.net).toBe(1000);
    expect(expenseGroups).toEqual([]);
  });

  it("net is negative when expenses exceed income", () => {
    const txns = [
      makeTxn({ type: "income", amount: 500 }),
      makeTxn({ type: "expense", amount: 1500 }),
    ];

    const { summary } = buildCashflowRows(txns);
    expect(summary.net).toBe(-1000);
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("buildCashflowRows — groupBy", () => {
  const txns = [
    makeTxn({ type: "expense", amount: 100, category_name: "Food", group_name: "Essentials" }),
    makeTxn({ type: "expense", amount: 200, category_name: "Food", group_name: "Essentials" }),
    makeTxn({ type: "expense", amount: 300, category_name: "Transport", group_name: "Commute" }),
    makeTxn({ type: "income", amount: 5000, category_name: "Salary", group_name: "Job" }),
  ];

  describe('groupBy = "none"', () => {
    it("puts all rows of the same type in a single unnamed group", () => {
      const { expenseGroups, incomeGroups } = buildCashflowRows(txns, "none");
      expect(expenseGroups).toHaveLength(1);
      expect(expenseGroups[0]!.name).toBe("");
      expect(expenseGroups[0]!.rows).toHaveLength(3);
      expect(incomeGroups).toHaveLength(1);
      expect(incomeGroups[0]!.rows).toHaveLength(1);
    });

    it("computes group total", () => {
      const { expenseGroups } = buildCashflowRows(txns, "none");
      expect(expenseGroups[0]!.total).toBe(600);
    });
  });

  describe('groupBy = "category"', () => {
    it("groups by category name", () => {
      const { expenseGroups } = buildCashflowRows(txns, "category");
      const names = expenseGroups.map((g) => g.name);
      expect(names).toContain("Food");
      expect(names).toContain("Transport");
    });

    it("sums totals per group", () => {
      const { expenseGroups } = buildCashflowRows(txns, "category");
      const food = expenseGroups.find((g) => g.name === "Food")!;
      expect(food.total).toBe(300);
      expect(food.rows).toHaveLength(2);
    });

    it("sorts groups by total descending", () => {
      const moreTxns = [
        makeTxn({ type: "expense", amount: 500, category_name: "Rent" }),
        makeTxn({ type: "expense", amount: 100, category_name: "Food" }),
        makeTxn({ type: "expense", amount: 300, category_name: "Transport" }),
      ];
      const { expenseGroups } = buildCashflowRows(moreTxns, "category");
      expect(expenseGroups[0]!.name).toBe("Rent");       // 500
      expect(expenseGroups[1]!.name).toBe("Transport");   // 300
      expect(expenseGroups[2]!.name).toBe("Food");         // 100
    });

    it('uses "Uncategorized" for null category_name', () => {
      const t = [makeTxn({ category_name: null })];
      const { expenseGroups } = buildCashflowRows(t, "category");
      expect(expenseGroups[0]!.name).toBe("Uncategorized");
    });
  });

  describe('groupBy = "group_name"', () => {
    it("groups by group_name", () => {
      const { expenseGroups } = buildCashflowRows(txns, "group_name");
      const names = expenseGroups.map((g) => g.name);
      expect(names).toContain("Essentials");
      expect(names).toContain("Commute");
    });

    it('uses "Ungrouped" for empty group_name', () => {
      const t = [makeTxn({ group_name: "" })];
      const { expenseGroups } = buildCashflowRows(t, "group_name");
      expect(expenseGroups[0]!.name).toBe("Ungrouped");
    });
  });

  describe('groupBy = "type"', () => {
    it("creates one group per type with correct labels", () => {
      const { expenseGroups, incomeGroups } = buildCashflowRows(txns, "type");
      expect(expenseGroups).toHaveLength(1);
      expect(expenseGroups[0]!.name).toBe("Expenses");
      expect(incomeGroups).toHaveLength(1);
      expect(incomeGroups[0]!.name).toBe("Income");
    });
  });
});

// ---------------------------------------------------------------------------
// Multiple simultaneous scenarios
// ---------------------------------------------------------------------------

describe("buildCashflowRows — mixed scenarios", () => {
  it("handles many small transactions", () => {
    const txns = Array.from({ length: 100 }, (_, i) =>
      makeTxn({
        amount: 10,
        type: i % 2 === 0 ? "income" : "expense",
        category_name: `Cat-${i % 5}`,
      })
    );

    const { summary } = buildCashflowRows(txns, "category");
    expect(summary.income).toBe(500);
    expect(summary.expenses).toBe(500);
    expect(summary.net).toBe(0);
  });

  it("decimal amounts sum accurately", () => {
    const txns = [
      makeTxn({ type: "expense", amount: 33.33 }),
      makeTxn({ type: "expense", amount: 33.33 }),
      makeTxn({ type: "expense", amount: 33.34 }),
    ];

    const { summary } = buildCashflowRows(txns);
    expect(summary.expenses).toBeCloseTo(100);
  });
});
