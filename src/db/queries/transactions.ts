import type { DbClient } from "../client.ts";
import type { Transaction } from "../../types/database.ts";
import { SET_UPDATED_AT } from "../schema.ts";

export interface TransactionWithCategory extends Transaction {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  recurring_frequency: string | null;
}

export async function createTransaction(
  db: DbClient,
  txn: {
    id: string;
    amount: number;
    type: "income" | "expense";
    category_id: string | null;
    date: string;
    payee?: string;
    notes?: string;
    recurring_id?: string | null;
    status?: "planned" | "confirmed" | "review";
    group_name?: string;
  }
): Promise<void> {
  await db.exec(
    `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      txn.id,
      txn.amount,
      txn.type,
      txn.category_id,
      txn.date,
      txn.payee ?? "",
      txn.notes ?? "",
      txn.recurring_id ?? null,
      txn.status ?? "confirmed",
      txn.group_name ?? "",
    ]
  );
}

export async function updateTransaction(
  db: DbClient,
  id: string,
  updates: {
    amount?: number;
    type?: "income" | "expense";
    category_id?: string | null;
    date?: string;
    payee?: string;
    notes?: string;
    status?: "planned" | "confirmed" | "review";
    group_name?: string;
    recurring_id?: string | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.amount !== undefined) {
    sets.push("amount = ?");
    params.push(updates.amount);
  }
  if (updates.type !== undefined) {
    sets.push("type = ?");
    params.push(updates.type);
  }
  if (updates.category_id !== undefined) {
    sets.push("category_id = ?");
    params.push(updates.category_id);
  }
  if (updates.date !== undefined) {
    sets.push("date = ?");
    params.push(updates.date);
  }
  if (updates.payee !== undefined) {
    sets.push("payee = ?");
    params.push(updates.payee);
  }
  if (updates.notes !== undefined) {
    sets.push("notes = ?");
    params.push(updates.notes);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.group_name !== undefined) {
    sets.push("group_name = ?");
    params.push(updates.group_name);
  }
  if (updates.recurring_id !== undefined) {
    sets.push("recurring_id = ?");
    params.push(updates.recurring_id);
  }

  if (sets.length === 0) return;
  sets.push(SET_UPDATED_AT);
  params.push(id);

  await db.exec(
    `UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deleteTransaction(
  db: DbClient,
  id: string
): Promise<void> {
  await db.exec("DELETE FROM transactions WHERE id = ?", [id]);
}

export async function deleteTransactionsBatch(
  db: DbClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.exec(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
}

export async function updateTransactionsBatch(
  db: DbClient,
  ids: string[],
  updates: { status?: "planned" | "confirmed"; category_id?: string | null }
): Promise<void> {
  if (ids.length === 0) return;
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.category_id !== undefined) { sets.push("category_id = ?"); params.push(updates.category_id); }
  if (sets.length === 0) return;
  sets.push(SET_UPDATED_AT);
  const placeholders = ids.map(() => "?").join(",");
  params.push(...ids);
  await db.exec(`UPDATE transactions SET ${sets.join(", ")} WHERE id IN (${placeholders})`, params);
}

/** Delete all future planned/review instances of a recurring rule after a given date (exclusive). */
export async function deleteFutureInstancesOfRule(
  db: DbClient,
  recurringId: string,
  afterDate: string
): Promise<void> {
  await db.exec(
    `DELETE FROM transactions WHERE recurring_id = ? AND status IN ('planned', 'review') AND date > ?`,
    [recurringId, afterDate]
  );
}

/** Bulk-update fields on future planned/review instances of a recurring rule. */
export async function updateFutureInstancesOfRule(
  db: DbClient,
  recurringId: string,
  afterDate: string,
  updates: { amount?: number; payee?: string; category_id?: string | null }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.amount !== undefined) { sets.push("amount = ?"); params.push(updates.amount); }
  if (updates.payee !== undefined) { sets.push("payee = ?"); params.push(updates.payee); }
  if (updates.category_id !== undefined) { sets.push("category_id = ?"); params.push(updates.category_id); }

  if (sets.length === 0) return;
  sets.push(SET_UPDATED_AT);
  params.push(recurringId, afterDate);

  await db.exec(
    `UPDATE transactions SET ${sets.join(", ")} WHERE recurring_id = ? AND status IN ('planned', 'review') AND date > ?`,
    params
  );
}

