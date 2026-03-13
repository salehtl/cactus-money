import { createTestDb, type TestDb } from "../../test/db-helpers";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactionsBatch,
  updateTransactionsBatch,
  deleteFutureInstancesOfRule,
  updateFutureInstancesOfRule,
} from "./transactions";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

async function seedCategory(id = "cat-1") {
  await db.exec(
    "INSERT INTO categories (id, name, color, icon, is_income) VALUES (?, ?, ?, ?, ?)",
    [id, "Test", "#000", "", 0]
  );
}

async function seedRecurring(id = "rec-1") {
  await db.exec(
    `INSERT INTO recurring_transactions (id, amount, type, category_id, frequency, start_date, next_occurrence)
     VALUES (?, 100, 'expense', 'cat-1', 'monthly', '2026-01-15', '2026-03-15')`,
    [id]
  );
}

async function getAllTransactions() {
  const { rows } = await db.exec<{
    id: string; amount: number; type: string; date: string;
    payee: string; notes: string; status: string; recurring_id: string | null;
    group_name: string; category_id: string | null;
  }>("SELECT * FROM transactions ORDER BY date");
  return rows;
}

// ---------------------------------------------------------------------------
// createTransaction
// ---------------------------------------------------------------------------

describe("createTransaction", () => {
  it("inserts a transaction with required fields", async () => {
    await seedCategory();
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 250,
      type: "expense",
      category_id: "cat-1",
      date: "2026-03-15",
    });

    const txns = await getAllTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0]!.amount).toBe(250);
    expect(txns[0]!.type).toBe("expense");
    expect(txns[0]!.date).toBe("2026-03-15");
  });

  it("applies defaults for optional fields", async () => {
    await seedCategory();
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 100,
      type: "income",
      category_id: "cat-1",
      date: "2026-03-15",
    });

    const txns = await getAllTransactions();
    expect(txns[0]!.payee).toBe("");
    expect(txns[0]!.notes).toBe("");
    expect(txns[0]!.status).toBe("confirmed");
    expect(txns[0]!.group_name).toBe("");
    expect(txns[0]!.recurring_id).toBeNull();
  });

  it("accepts all optional fields", async () => {
    await seedCategory();
    await seedRecurring();
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      date: "2026-03-15",
      payee: "Netflix",
      notes: "March subscription",
      recurring_id: "rec-1",
      status: "planned",
      group_name: "Entertainment",
    });

    const txns = await getAllTransactions();
    expect(txns[0]!.payee).toBe("Netflix");
    expect(txns[0]!.notes).toBe("March subscription");
    expect(txns[0]!.recurring_id).toBe("rec-1");
    expect(txns[0]!.status).toBe("planned");
    expect(txns[0]!.group_name).toBe("Entertainment");
  });

  it("allows null category_id", async () => {
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 50,
      type: "expense",
      category_id: null,
      date: "2026-03-15",
    });

    const txns = await getAllTransactions();
    expect(txns[0]!.category_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTransaction
// ---------------------------------------------------------------------------

describe("updateTransaction", () => {
  beforeEach(async () => {
    await seedCategory();
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      date: "2026-03-15",
      payee: "Old Payee",
      status: "planned",
    });
  });

  it("updates a single field", async () => {
    await updateTransaction(db as any, "txn-1", { amount: 200 });
    const txns = await getAllTransactions();
    expect(txns[0]!.amount).toBe(200);
  });

  it("updates multiple fields", async () => {
    await updateTransaction(db as any, "txn-1", {
      amount: 300,
      payee: "New Payee",
      status: "confirmed",
    });

    const txns = await getAllTransactions();
    expect(txns[0]!.amount).toBe(300);
    expect(txns[0]!.payee).toBe("New Payee");
    expect(txns[0]!.status).toBe("confirmed");
  });

  it("no-ops on empty updates", async () => {
    await updateTransaction(db as any, "txn-1", {});
    const txns = await getAllTransactions();
    expect(txns[0]!.amount).toBe(100);
  });

  it("can set category_id to null", async () => {
    await updateTransaction(db as any, "txn-1", { category_id: null });
    const txns = await getAllTransactions();
    expect(txns[0]!.category_id).toBeNull();
  });

  it("can update recurring_id", async () => {
    await seedRecurring();
    await updateTransaction(db as any, "txn-1", { recurring_id: "rec-1" });
    const txns = await getAllTransactions();
    expect(txns[0]!.recurring_id).toBe("rec-1");
  });
});

// ---------------------------------------------------------------------------
// deleteTransaction
// ---------------------------------------------------------------------------

describe("deleteTransaction", () => {
  it("removes the transaction", async () => {
    await seedCategory();
    await createTransaction(db as any, {
      id: "txn-1",
      amount: 100,
      type: "expense",
      category_id: "cat-1",
      date: "2026-03-15",
    });

    await deleteTransaction(db as any, "txn-1");
    const txns = await getAllTransactions();
    expect(txns).toHaveLength(0);
  });

  it("does not affect other transactions", async () => {
    await seedCategory();
    await createTransaction(db as any, { id: "txn-1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15" });
    await createTransaction(db as any, { id: "txn-2", amount: 200, type: "expense", category_id: "cat-1", date: "2026-03-16" });

    await deleteTransaction(db as any, "txn-1");
    const txns = await getAllTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0]!.id).toBe("txn-2");
  });
});

// ---------------------------------------------------------------------------
// deleteTransactionsBatch
// ---------------------------------------------------------------------------

describe("deleteTransactionsBatch", () => {
  beforeEach(async () => {
    await seedCategory();
    await createTransaction(db as any, { id: "txn-1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15" });
    await createTransaction(db as any, { id: "txn-2", amount: 200, type: "expense", category_id: "cat-1", date: "2026-03-16" });
    await createTransaction(db as any, { id: "txn-3", amount: 300, type: "expense", category_id: "cat-1", date: "2026-03-17" });
  });

  it("deletes multiple transactions at once", async () => {
    await deleteTransactionsBatch(db as any, ["txn-1", "txn-3"]);
    const txns = await getAllTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0]!.id).toBe("txn-2");
  });

  it("handles empty array gracefully", async () => {
    await deleteTransactionsBatch(db as any, []);
    const txns = await getAllTransactions();
    expect(txns).toHaveLength(3);
  });

  it("handles single-element array", async () => {
    await deleteTransactionsBatch(db as any, ["txn-2"]);
    const txns = await getAllTransactions();
    expect(txns).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// updateTransactionsBatch
// ---------------------------------------------------------------------------

describe("updateTransactionsBatch", () => {
  beforeEach(async () => {
    await seedCategory();
    await seedCategory("cat-2");
    await createTransaction(db as any, { id: "txn-1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15", status: "planned" });
    await createTransaction(db as any, { id: "txn-2", amount: 200, type: "expense", category_id: "cat-1", date: "2026-03-16", status: "planned" });
    await createTransaction(db as any, { id: "txn-3", amount: 300, type: "expense", category_id: "cat-1", date: "2026-03-17", status: "confirmed" });
  });

  it("bulk updates status", async () => {
    await updateTransactionsBatch(db as any, ["txn-1", "txn-2"], { status: "confirmed" });
    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-1")!.status).toBe("confirmed");
    expect(txns.find((t) => t.id === "txn-2")!.status).toBe("confirmed");
    expect(txns.find((t) => t.id === "txn-3")!.status).toBe("confirmed"); // unchanged
  });

  it("bulk updates category_id", async () => {
    await updateTransactionsBatch(db as any, ["txn-1", "txn-3"], { category_id: "cat-2" });
    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-1")!.category_id).toBe("cat-2");
    expect(txns.find((t) => t.id === "txn-3")!.category_id).toBe("cat-2");
    expect(txns.find((t) => t.id === "txn-2")!.category_id).toBe("cat-1"); // unchanged
  });

  it("handles empty ids gracefully", async () => {
    await updateTransactionsBatch(db as any, [], { status: "confirmed" });
    // No crash
  });

  it("handles empty updates gracefully", async () => {
    await updateTransactionsBatch(db as any, ["txn-1"], {});
    // No crash, no change
    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-1")!.status).toBe("planned");
  });
});

// ---------------------------------------------------------------------------
// deleteFutureInstancesOfRule
// ---------------------------------------------------------------------------

describe("deleteFutureInstancesOfRule", () => {
  beforeEach(async () => {
    await seedCategory();
    await seedRecurring();
  });

  it("deletes planned/review transactions after the given date", async () => {
    await createTransaction(db as any, { id: "txn-past", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-01", recurring_id: "rec-1", status: "confirmed" });
    await createTransaction(db as any, { id: "txn-today", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-15", recurring_id: "rec-1", status: "planned" });
    await createTransaction(db as any, { id: "txn-future1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-20", recurring_id: "rec-1", status: "planned" });
    await createTransaction(db as any, { id: "txn-future2", amount: 100, type: "expense", category_id: "cat-1", date: "2026-04-15", recurring_id: "rec-1", status: "review" });

    await deleteFutureInstancesOfRule(db as any, "rec-1", "2026-03-15");

    const txns = await getAllTransactions();
    const ids = txns.map((t) => t.id);
    expect(ids).toContain("txn-past");
    expect(ids).toContain("txn-today");
    expect(ids).not.toContain("txn-future1");
    expect(ids).not.toContain("txn-future2");
  });

  it("keeps confirmed future transactions", async () => {
    await createTransaction(db as any, { id: "txn-confirmed-future", amount: 100, type: "expense", category_id: "cat-1", date: "2026-04-15", recurring_id: "rec-1", status: "confirmed" });

    await deleteFutureInstancesOfRule(db as any, "rec-1", "2026-03-15");

    const txns = await getAllTransactions();
    expect(txns.map((t) => t.id)).toContain("txn-confirmed-future");
  });

  it("does not affect transactions from other rules", async () => {
    await seedRecurring("rec-2");
    await createTransaction(db as any, { id: "txn-other", amount: 50, type: "expense", category_id: "cat-1", date: "2026-04-15", recurring_id: "rec-2", status: "planned" });

    await deleteFutureInstancesOfRule(db as any, "rec-1", "2026-03-15");

    const txns = await getAllTransactions();
    expect(txns.map((t) => t.id)).toContain("txn-other");
  });
});

// ---------------------------------------------------------------------------
// updateFutureInstancesOfRule
// ---------------------------------------------------------------------------

describe("updateFutureInstancesOfRule", () => {
  beforeEach(async () => {
    await seedCategory();
    await seedCategory("cat-2");
    await seedRecurring();
    // Create planned future instances
    await createTransaction(db as any, { id: "txn-past", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-01", recurring_id: "rec-1", status: "confirmed" });
    await createTransaction(db as any, { id: "txn-future1", amount: 100, type: "expense", category_id: "cat-1", date: "2026-03-20", recurring_id: "rec-1", status: "planned" });
    await createTransaction(db as any, { id: "txn-future2", amount: 100, type: "expense", category_id: "cat-1", date: "2026-04-15", recurring_id: "rec-1", status: "planned" });
  });

  it("updates amount on future planned instances", async () => {
    await updateFutureInstancesOfRule(db as any, "rec-1", "2026-03-15", { amount: 250 });

    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-future1")!.amount).toBe(250);
    expect(txns.find((t) => t.id === "txn-future2")!.amount).toBe(250);
    expect(txns.find((t) => t.id === "txn-past")!.amount).toBe(100); // unchanged
  });

  it("updates payee on future planned instances", async () => {
    await updateFutureInstancesOfRule(db as any, "rec-1", "2026-03-15", { payee: "New Name" });

    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-future1")!.payee).toBe("New Name");
  });

  it("updates category_id on future planned instances", async () => {
    await updateFutureInstancesOfRule(db as any, "rec-1", "2026-03-15", { category_id: "cat-2" });

    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-future1")!.category_id).toBe("cat-2");
    expect(txns.find((t) => t.id === "txn-future2")!.category_id).toBe("cat-2");
  });

  it("no-ops on empty updates", async () => {
    await updateFutureInstancesOfRule(db as any, "rec-1", "2026-03-15", {});
    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-future1")!.amount).toBe(100);
  });

  it("only updates planned/review status, not confirmed", async () => {
    // Add a confirmed future instance
    await createTransaction(db as any, { id: "txn-confirmed", amount: 100, type: "expense", category_id: "cat-1", date: "2026-05-15", recurring_id: "rec-1", status: "confirmed" });

    await updateFutureInstancesOfRule(db as any, "rec-1", "2026-03-15", { amount: 999 });

    const txns = await getAllTransactions();
    expect(txns.find((t) => t.id === "txn-confirmed")!.amount).toBe(100); // unchanged
  });
});
