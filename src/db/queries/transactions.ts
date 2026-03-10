import type { DbClient } from "../client.ts";
import type { Transaction } from "../../types/database.ts";

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

  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
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

