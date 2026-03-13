import { createTestDb, type TestDb } from "../../test/db-helpers";
import { getTransactionsForMonth, getTransactionsForRange } from "./cashflow";
import { createTransaction } from "./transactions";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

async function seedCategory(id: string, name: string, isIncome = 0) {
  await db.exec(
    "INSERT INTO categories (id, name, color, icon, is_income) VALUES (?, ?, ?, ?, ?)",
    [id, name, "#ff0000", "icon", isIncome]
  );
}

async function seedRecurring(id: string, frequency: string) {
  await db.exec(
    `INSERT INTO recurring_transactions (id, amount, type, category_id, frequency, start_date, next_occurrence)
     VALUES (?, 100, 'expense', 'cat-1', ?, '2026-01-01', '2026-03-15')`,
    [id, frequency]
  );
}

// ---------------------------------------------------------------------------
// getTransactionsForMonth
// ---------------------------------------------------------------------------

describe("getTransactionsForMonth", () => {
  beforeEach(async () => {
    await seedCategory("cat-1", "Food");
  });

  it("returns transactions for the specified month", async () => {
    await createTransaction(db as any, { id: "t1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15" });
    await createTransaction(db as any, { id: "t2", amount: 200, type: "expense", category_id: "cat-1", date: "2026-03-20" });
    await createTransaction(db as any, { id: "t3", amount: 300, type: "expense", category_id: "cat-1", date: "2026-04-01" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });

  it("joins category name, color, and icon", async () => {
    await createTransaction(db as any, { id: "t1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows[0]!.category_name).toBe("Food");
    expect(rows[0]!.category_color).toBe("#ff0000");
    expect(rows[0]!.category_icon).toBe("icon");
  });

  it("joins recurring_frequency via LEFT JOIN", async () => {
    await seedRecurring("rec-1", "monthly");
    await createTransaction(db as any, { id: "t1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15", recurring_id: "rec-1" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows[0]!.recurring_frequency).toBe("monthly");
  });

  it("returns null recurring_frequency for non-recurring transactions", async () => {
    await createTransaction(db as any, { id: "t1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows[0]!.recurring_frequency).toBeNull();
  });

  it("handles null category_id", async () => {
    await createTransaction(db as any, { id: "t1", amount: 100, type: "expense", category_id: null, date: "2026-03-15" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows[0]!.category_name).toBeNull();
    expect(rows[0]!.category_color).toBeNull();
  });

  it("sorts by date DESC then created_at DESC", async () => {
    await createTransaction(db as any, { id: "t-early", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-01" });
    await createTransaction(db as any, { id: "t-late", amount: 200, type: "expense", category_id: "cat-1", date: "2026-03-28" });
    await createTransaction(db as any, { id: "t-mid", amount: 150, type: "expense", category_id: "cat-1", date: "2026-03-15" });

    const rows = await getTransactionsForMonth(db as any, "2026-03");
    expect(rows[0]!.id).toBe("t-late");
    expect(rows[1]!.id).toBe("t-mid");
    expect(rows[2]!.id).toBe("t-early");
  });

  it("returns empty array for month with no transactions", async () => {
    const rows = await getTransactionsForMonth(db as any, "2026-06");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTransactionsForRange
// ---------------------------------------------------------------------------

describe("getTransactionsForRange", () => {
  beforeEach(async () => {
    await seedCategory("cat-1", "Food");
    await createTransaction(db as any, { id: "t-jan", amount: 100, type: "expense", category_id: "cat-1", date: "2026-01-15" });
    await createTransaction(db as any, { id: "t-feb", amount: 200, type: "expense", category_id: "cat-1", date: "2026-02-15" });
    await createTransaction(db as any, { id: "t-mar", amount: 300, type: "expense", category_id: "cat-1", date: "2026-03-15" });
    await createTransaction(db as any, { id: "t-apr", amount: 400, type: "expense", category_id: "cat-1", date: "2026-04-15" });
  });

  it("returns transactions within the month range (inclusive)", async () => {
    const rows = await getTransactionsForRange(db as any, "2026-02", "2026-03");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["t-feb", "t-mar"]);
  });

  it("returns all when range spans full dataset", async () => {
    const rows = await getTransactionsForRange(db as any, "2026-01", "2026-04");
    expect(rows).toHaveLength(4);
  });

  it("returns empty when range has no transactions", async () => {
    const rows = await getTransactionsForRange(db as any, "2025-01", "2025-12");
    expect(rows).toEqual([]);
  });

  it("single-month range works", async () => {
    const rows = await getTransactionsForRange(db as any, "2026-03", "2026-03");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("t-mar");
  });

  it("joins category info", async () => {
    const rows = await getTransactionsForRange(db as any, "2026-01", "2026-01");
    expect(rows[0]!.category_name).toBe("Food");
  });
});
