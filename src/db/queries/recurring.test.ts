import { createTestDb, type TestDb } from "../../test/db-helpers";
import {
  createRecurring,
  getRecurringTransactions,
  updateRecurring,
  deleteRecurring,
  getDueRecurring,
  processRecurringRules,
  processRecurringRuleById,
  populateFutureMonth,
} from "./recurring";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// Helper: insert a category so FK constraints pass
async function seedCategory(id: string = "cat-1", isIncome: number = 0) {
  await db.exec(
    `INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_income, is_system)
     VALUES (?, 'Test', NULL, '#000', '', 0, ?, 0)`,
    [id, isIncome]
  );
}

// Helper: count transactions for a rule
async function countTxns(ruleId: string): Promise<number> {
  const { rows } = await db.exec<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM transactions WHERE recurring_id = ?",
    [ruleId]
  );
  return rows[0]!.cnt;
}

// Helper: get transaction dates for a rule, sorted
async function txnDates(ruleId: string): Promise<string[]> {
  const { rows } = await db.exec<{ date: string }>(
    "SELECT date FROM transactions WHERE recurring_id = ? ORDER BY date",
    [ruleId]
  );
  return rows.map((r) => r.date);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("createRecurring", () => {
  it("inserts a recurring rule", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-15",
      next_occurrence: "2026-03-15",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("rec-1");
    expect(rules[0]!.amount).toBe(100);
    expect(rules[0]!.frequency).toBe("monthly");
  });

  it("auto-computes anchor_day for monthly frequency", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-25",
      next_occurrence: "2026-03-25",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBe(25);
  });

  it("auto-computes anchor_day for quarterly frequency", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 500,
      type: "expense",
      category_id: "cat-1",
      frequency: "quarterly",
      start_date: "2026-01-31",
      next_occurrence: "2026-01-31",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBe(31);
  });

  it("does NOT set anchor_day for weekly frequency", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "weekly",
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBeNull();
  });

  it("uses explicit anchor_day when provided", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
      anchor_day: 28,
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBe(28);
  });

  it("defaults mode to 'reminder'", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.mode).toBe("reminder");
  });

  it("stores is_variable flag", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
      is_variable: 1,
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.is_variable).toBe(1);
  });

  it("stores custom_interval_days", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "custom",
      custom_interval_days: 10,
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
    });

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.custom_interval_days).toBe(10);
  });
});

describe("updateRecurring", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-03-15",
      anchor_day: 15,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates amount", async () => {
    await updateRecurring(db as any, "rec-1", { amount: 200 });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.amount).toBe(200);
  });

  it("updates payee", async () => {
    await updateRecurring(db as any, "rec-1", { payee: "Netflix" });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.payee).toBe("Netflix");
  });

  it("recomputes anchor_day when frequency changes", async () => {
    await updateRecurring(db as any, "rec-1", { frequency: "quarterly" });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBe(15);
    expect(rules[0]!.frequency).toBe("quarterly");
  });

  it("clears anchor_day when switching to weekly", async () => {
    await updateRecurring(db as any, "rec-1", { frequency: "weekly" });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBeNull();
  });

  it("recomputes anchor_day when start_date changes", async () => {
    await updateRecurring(db as any, "rec-1", { start_date: "2026-01-28" });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.anchor_day).toBe(28);
  });

  it("toggles is_active (boolean to 0/1)", async () => {
    await updateRecurring(db as any, "rec-1", { is_active: false });
    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.is_active).toBe(0);

    await updateRecurring(db as any, "rec-1", { is_active: true });
    const rules2 = await getRecurringTransactions(db as any);
    expect(rules2[0]!.is_active).toBe(1);
  });

  it("no-ops on empty updates", async () => {
    const before = (await getRecurringTransactions(db as any))[0]!;
    await updateRecurring(db as any, "rec-1", {});
    const after = (await getRecurringTransactions(db as any))[0]!;
    expect(after.amount).toBe(before.amount);
  });
});

describe("deleteRecurring", () => {
  it("removes the rule", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-01",
      next_occurrence: "2026-03-01",
    });

    await deleteRecurring(db as any, "rec-1");
    const rules = await getRecurringTransactions(db as any);
    expect(rules).toHaveLength(0);
  });
});

describe("getDueRecurring", () => {
  it("returns rules with next_occurrence <= given date", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-due",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-01",
      next_occurrence: "2026-03-01",
    });
    await createRecurring(db as any, {
      id: "rec-future",
      amount: 75,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-01",
      next_occurrence: "2026-04-01",
    });

    const due = await getDueRecurring(db as any, "2026-03-15");
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe("rec-due");
  });

  it("excludes inactive rules", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-inactive",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-01",
      next_occurrence: "2026-03-01",
    });
    await updateRecurring(db as any, "rec-inactive", { is_active: false });

    const due = await getDueRecurring(db as any, "2026-03-15");
    expect(due).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler: processRecurringRules / processRecurringRuleById
// ---------------------------------------------------------------------------

describe("processRecurringRules", () => {
  it("generates confirmed transactions for past occurrences of a weekly rule", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-weekly-1";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Groceries",
      frequency: "weekly",
      start_date: "2026-03-01",
      next_occurrence: "2026-03-01",
      mode: "auto",
    });

    // Process as of March 22 — should catch up Mar 1, 8, 15, 22
    const count = await processRecurringRules(db as any, "2026-03-22");
    // 4 past + remaining current month planned (29th)
    expect(count).toBeGreaterThanOrEqual(4);

    const dates = await txnDates(ruleId);
    expect(dates).toContain("2026-03-01");
    expect(dates).toContain("2026-03-08");
    expect(dates).toContain("2026-03-15");
    expect(dates).toContain("2026-03-22");
    // Should also have planned for March 29
    expect(dates).toContain("2026-03-29");
  });

  it("generates planned transactions for remaining current-month occurrences", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-weekly-2";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 50,
      type: "expense",
      category_id: "cat1",
      payee: "Coffee",
      frequency: "weekly",
      start_date: "2026-03-02",
      next_occurrence: "2026-03-02",
      mode: "auto",
    });

    // Process as of March 5 — past: Mar 2 (confirmed). Future this month: 9, 16, 23, 30 (planned)
    await processRecurringRules(db as any, "2026-03-05");

    const { rows } = await db.exec<{ date: string; status: string }>(
      "SELECT date, status FROM transactions WHERE recurring_id = ? ORDER BY date",
      [ruleId]
    );

    // Mar 2 should be confirmed (past), rest should be planned (future)
    const confirmed = rows.filter((r) => r.status === "confirmed");
    const planned = rows.filter((r) => r.status === "planned");
    expect(confirmed.length).toBe(1); // Mar 2
    expect(planned.length).toBe(4); // Mar 9, 16, 23, 30

    expect(rows.length).toBe(5);
  });

  it("deactivates rule when end_date is reached", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-end-date";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 200,
      type: "expense",
      category_id: "cat1",
      payee: "Subscription",
      frequency: "monthly",
      start_date: "2026-01-15",
      end_date: "2026-03-15",
      next_occurrence: "2026-01-15",
      mode: "auto",
    });

    await processRecurringRules(db as any, "2026-04-01");

    // Rule should be deactivated
    const { rows } = await db.exec<{ is_active: number }>(
      "SELECT is_active FROM recurring_transactions WHERE id = ?",
      [ruleId]
    );
    expect(rows[0]!.is_active).toBe(0);

    // Should have transactions for Jan 15, Feb 15, Mar 15 only
    const dates = await txnDates(ruleId);
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("is idempotent — running twice does not create duplicates", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-idempotent";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Rent",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      mode: "auto",
    });

    await processRecurringRules(db as any, "2026-03-20");
    const count1 = await countTxns(ruleId);

    // Run again
    await processRecurringRules(db as any, "2026-03-20");
    const count2 = await countTxns(ruleId);

    expect(count2).toBe(count1);
  });

  it("generates catch-up transactions for monthly rule with anchor_day", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      anchor_day: 15,
    });

    const count = await processRecurringRules(db as any, "2026-03-20");
    expect(count).toBe(3); // Jan 15, Feb 15, Mar 15

    const dates = await txnDates("rec-1");
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("sets status to 'confirmed' for past catch-up (non-variable)", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      anchor_day: 15,
      is_variable: 0,
    });

    await processRecurringRules(db as any, "2026-02-20");

    const { rows } = await db.exec<{ status: string }>(
      "SELECT status FROM transactions WHERE recurring_id = ? AND date <= '2026-02-20'",
      ["rec-1"]
    );
    expect(rows.every((r) => r.status === "confirmed")).toBe(true);
  });

  it("sets status to 'review' for variable rules", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      anchor_day: 15,
      is_variable: 1,
    });

    await processRecurringRules(db as any, "2026-02-20");

    const { rows } = await db.exec<{ date: string; status: string }>(
      "SELECT date, status FROM transactions WHERE recurring_id = ? AND date <= '2026-02-20' ORDER BY date",
      ["rec-1"]
    );
    expect(rows.every((r) => r.status === "review")).toBe(true);
  });

  it("generates future planned transactions for remaining current month", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-15",
      next_occurrence: "2026-03-15",
      anchor_day: 15,
    });

    const count = await processRecurringRules(db as any, "2026-03-05");
    expect(count).toBe(1);

    const { rows } = await db.exec<{ date: string; status: string }>(
      "SELECT date, status FROM transactions WHERE recurring_id = ?",
      ["rec-1"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-03-15");
    expect(rows[0]!.status).toBe("planned");
  });

  it("weekly rule generates multiple planned instances in current month", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-w",
      amount: 50,
      type: "expense",
      category_id: "cat-1",
      frequency: "weekly",
      start_date: "2026-03-07",
      next_occurrence: "2026-03-07",
    });

    const count = await processRecurringRules(db as any, "2026-03-01");
    // Planned: Mar 7, 14, 21, 28
    expect(count).toBe(4);
  });

  it("advances next_occurrence after processing", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-15",
      next_occurrence: "2026-03-15",
      anchor_day: 15,
    });

    await processRecurringRules(db as any, "2026-03-20");

    const rules = await getRecurringTransactions(db as any);
    expect(rules[0]!.next_occurrence).toBe("2026-04-15");
  });

  it("handles daily rule generating many transactions", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-daily",
      amount: 10,
      type: "expense",
      category_id: "cat-1",
      frequency: "daily",
      start_date: "2026-03-01",
      next_occurrence: "2026-03-01",
    });

    const count = await processRecurringRules(db as any, "2026-03-10");
    // 10 catch-up (Mar 1-10) + 21 planned (Mar 11-31)
    expect(count).toBe(31);

    const txnCount = await countTxns("rec-daily");
    expect(txnCount).toBe(31);
  });

  it("processes multiple rules independently", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-a",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-10",
      next_occurrence: "2026-03-10",
      anchor_day: 10,
    });
    await createRecurring(db as any, {
      id: "rec-b",
      amount: 200,
      type: "income",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-20",
      next_occurrence: "2026-03-20",
      anchor_day: 20,
    });

    await processRecurringRules(db as any, "2026-03-25");

    expect(await countTxns("rec-a")).toBe(1);
    expect(await countTxns("rec-b")).toBe(1);
  });

  it("skips inactive rules", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-inactive",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-15",
      next_occurrence: "2026-03-15",
    });
    await updateRecurring(db as any, "rec-inactive", { is_active: false });

    const count = await processRecurringRules(db as any, "2026-03-20");
    expect(count).toBe(0);
  });
});

describe("processRecurringRuleById", () => {
  it("processes a single rule by ID", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-single";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 75,
      type: "income",
      category_id: "cat1",
      payee: "Freelance",
      frequency: "biweekly",
      start_date: "2026-03-01",
      next_occurrence: "2026-03-01",
      mode: "auto",
    });

    const count = await processRecurringRuleById(db as any, ruleId, "2026-03-20");
    expect(count).toBeGreaterThanOrEqual(1);

    const dates = await txnDates(ruleId);
    expect(dates).toContain("2026-03-01");
    expect(dates).toContain("2026-03-15");
    // Mar 29 should be planned
    expect(dates).toContain("2026-03-29");
  });

  it("returns 0 for non-existent rule", async () => {
    const count = await processRecurringRuleById(db as any, "non-existent", "2026-03-20");
    expect(count).toBe(0);
  });

  it("only processes the specified rule, not others", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-15",
      next_occurrence: "2026-03-15",
      anchor_day: 15,
    });
    await createRecurring(db as any, {
      id: "rec-2",
      amount: 200,
      type: "income",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-03-20",
      next_occurrence: "2026-03-20",
      anchor_day: 20,
    });

    await processRecurringRuleById(db as any, "rec-1", "2026-03-20");

    expect(await countTxns("rec-1")).toBe(1);
    expect(await countTxns("rec-2")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// populateFutureMonth
// ---------------------------------------------------------------------------

describe("populateFutureMonth", () => {
  it("generates all weekly occurrences for a future month", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-future-weekly";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Gym",
      frequency: "weekly",
      start_date: "2026-03-02",
      next_occurrence: "2026-03-02",
      mode: "auto",
    });

    await populateFutureMonth(db as any, "2026-04");

    const dates = await txnDates(ruleId);
    // April 2026 Mondays: 6, 13, 20, 27
    expect(dates).toEqual(["2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27"]);

    // All should be planned
    const { rows } = await db.exec<{ status: string }>(
      "SELECT DISTINCT status FROM transactions WHERE recurring_id = ?",
      [ruleId]
    );
    expect(rows).toEqual([{ status: "planned" }]);
  });

  it("generates a single monthly occurrence", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-future-monthly";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 500,
      type: "expense",
      category_id: "cat1",
      payee: "Rent",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      mode: "auto",
    });

    await populateFutureMonth(db as any, "2026-04");

    const dates = await txnDates(ruleId);
    expect(dates).toEqual(["2026-04-15"]);
  });

  it("uses per-date dedup (not per-month)", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-dedup";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Gym",
      frequency: "weekly",
      start_date: "2026-04-06",
      next_occurrence: "2026-04-06",
      mode: "auto",
    });

    // First call
    await populateFutureMonth(db as any, "2026-04");
    const count1 = await countTxns(ruleId);

    // Second call — should not duplicate
    await populateFutureMonth(db as any, "2026-04");
    const count2 = await countTxns(ruleId);

    expect(count2).toBe(count1);
    expect(count1).toBeGreaterThanOrEqual(4); // 4 Mondays in April 2026
  });

  it("does not generate if rule is inactive", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-inactive";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Old Sub",
      frequency: "monthly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      mode: "auto",
    });
    // Deactivate
    await db.exec("UPDATE recurring_transactions SET is_active = 0 WHERE id = ?", [ruleId]);

    await populateFutureMonth(db as any, "2026-04");
    const count = await countTxns(ruleId);
    expect(count).toBe(0);
  });

  it("respects end_date", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-ended";
    await createRecurring(db as any, {
      id: ruleId,
      amount: 100,
      type: "expense",
      category_id: "cat1",
      payee: "Trial Sub",
      frequency: "monthly",
      start_date: "2026-01-15",
      end_date: "2026-03-31",
      next_occurrence: "2026-01-15",
      mode: "auto",
    });

    await populateFutureMonth(db as any, "2026-04");
    const count = await countTxns(ruleId);
    expect(count).toBe(0);
  });

  it("handles quarterly rule — only populates quarter month", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-q",
      amount: 500,
      type: "expense",
      category_id: "cat-1",
      frequency: "quarterly",
      start_date: "2026-01-15",
      next_occurrence: "2026-01-15",
      anchor_day: 15,
    });

    await populateFutureMonth(db as any, "2026-04");
    await populateFutureMonth(db as any, "2026-05");

    const { rows: aprRows } = await db.exec(
      "SELECT * FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = '2026-04'",
      ["rec-q"]
    );
    const { rows: mayRows } = await db.exec(
      "SELECT * FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = '2026-05'",
      ["rec-q"]
    );
    expect(aprRows).toHaveLength(1);
    expect(mayRows).toHaveLength(0);
  });

  it("handles daily rule in a future month", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-daily",
      amount: 5,
      type: "expense",
      category_id: "cat-1",
      frequency: "daily",
      start_date: "2026-03-01",
      next_occurrence: "2026-03-01",
    });

    await populateFutureMonth(db as any, "2026-04");

    const txnCount = await countTxns("rec-daily");
    expect(txnCount).toBe(30); // April has 30 days
  });

  it("clamps monthly anchor_day 31 to Feb 28", async () => {
    await seedCategory();
    await createRecurring(db as any, {
      id: "rec-31",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      frequency: "monthly",
      start_date: "2026-01-31",
      next_occurrence: "2026-01-31",
      anchor_day: 31,
    });

    await populateFutureMonth(db as any, "2026-02");

    const dates = await txnDates("rec-31");
    expect(dates).toEqual(["2026-02-28"]);
  });
});
