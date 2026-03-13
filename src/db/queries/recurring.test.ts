import { createTestDb, type TestDb } from "../../test/db-helpers";
import {
  createRecurring,
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
async function seedCategory(id: string, isIncome: number = 0) {
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

describe("processRecurringRules", () => {
  it("generates confirmed transactions for past occurrences of a weekly rule", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-weekly-1";
    await createRecurring(db, {
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
    const count = await processRecurringRules(db, "2026-03-22");
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
    await createRecurring(db, {
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
    await processRecurringRules(db, "2026-03-05");

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
    await createRecurring(db, {
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

    await processRecurringRules(db, "2026-04-01");

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
    await createRecurring(db, {
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

    await processRecurringRules(db, "2026-03-20");
    const count1 = await countTxns(ruleId);

    // Run again
    await processRecurringRules(db, "2026-03-20");
    const count2 = await countTxns(ruleId);

    expect(count2).toBe(count1);
  });
});

describe("processRecurringRuleById", () => {
  it("processes a single rule by ID", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-single";
    await createRecurring(db, {
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

    const count = await processRecurringRuleById(db, ruleId, "2026-03-20");
    expect(count).toBeGreaterThanOrEqual(1);

    const dates = await txnDates(ruleId);
    expect(dates).toContain("2026-03-01");
    expect(dates).toContain("2026-03-15");
    // Mar 29 should be planned
    expect(dates).toContain("2026-03-29");
  });

  it("returns 0 for non-existent rule", async () => {
    const count = await processRecurringRuleById(db, "non-existent", "2026-03-20");
    expect(count).toBe(0);
  });
});

describe("populateFutureMonth", () => {
  it("generates all weekly occurrences for a future month", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-future-weekly";
    await createRecurring(db, {
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

    await populateFutureMonth(db, "2026-04");

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
    await createRecurring(db, {
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

    await populateFutureMonth(db, "2026-04");

    const dates = await txnDates(ruleId);
    expect(dates).toEqual(["2026-04-15"]);
  });

  it("uses per-date dedup (not per-month)", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-dedup";
    await createRecurring(db, {
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
    await populateFutureMonth(db, "2026-04");
    const count1 = await countTxns(ruleId);

    // Second call — should not duplicate
    await populateFutureMonth(db, "2026-04");
    const count2 = await countTxns(ruleId);

    expect(count2).toBe(count1);
    expect(count1).toBeGreaterThanOrEqual(4); // 4 Mondays in April 2026
  });

  it("does not generate if rule is inactive", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-inactive";
    await createRecurring(db, {
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

    await populateFutureMonth(db, "2026-04");
    const count = await countTxns(ruleId);
    expect(count).toBe(0);
  });

  it("respects end_date", async () => {
    await seedCategory("cat1");
    const ruleId = "rule-ended";
    await createRecurring(db, {
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

    await populateFutureMonth(db, "2026-04");
    const count = await countTxns(ruleId);
    expect(count).toBe(0);
  });
});
