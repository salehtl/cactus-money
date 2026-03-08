import type { DbClient } from "../client.ts";
import type { RecurringTransaction } from "../../types/database.ts";
import { getNextOccurrence } from "../../lib/recurring.ts";

export async function getRecurringTransactions(
  db: DbClient
): Promise<RecurringTransaction[]> {
  const { rows } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions ORDER BY next_occurrence, created_at"
  );
  return rows;
}

export async function createRecurring(
  db: DbClient,
  rec: {
    id: string;
    amount: number;
    type: "income" | "expense";
    category_id: string | null;
    payee?: string;
    notes?: string;
    frequency: string;
    custom_interval_days?: number | null;
    start_date: string;
    end_date?: string | null;
    next_occurrence: string;
    mode?: "reminder" | "auto";
  }
): Promise<void> {
  await db.exec(
    `INSERT INTO recurring_transactions
     (id, amount, type, category_id, payee, notes, frequency, custom_interval_days, start_date, end_date, next_occurrence, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec.id,
      rec.amount,
      rec.type,
      rec.category_id,
      rec.payee ?? "",
      rec.notes ?? "",
      rec.frequency,
      rec.custom_interval_days ?? null,
      rec.start_date,
      rec.end_date ?? null,
      rec.next_occurrence,
      rec.mode ?? "reminder",
    ]
  );
}

export async function updateRecurring(
  db: DbClient,
  id: string,
  updates: Partial<{
    amount: number;
    type: "income" | "expense";
    category_id: string | null;
    payee: string;
    notes: string;
    frequency: string;
    custom_interval_days: number | null;
    start_date: string;
    end_date: string | null;
    next_occurrence: string;
    mode: "reminder" | "auto";
    is_active: boolean;
  }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const fields = [
    "amount",
    "type",
    "category_id",
    "payee",
    "notes",
    "frequency",
    "custom_interval_days",
    "start_date",
    "end_date",
    "next_occurrence",
    "mode",
  ] as const;

  for (const field of fields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(updates[field]);
    }
  }
  if (updates.is_active !== undefined) {
    sets.push("is_active = ?");
    params.push(updates.is_active ? 1 : 0);
  }

  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);

  await db.exec(
    `UPDATE recurring_transactions SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deleteRecurring(
  db: DbClient,
  id: string
): Promise<void> {
  await db.exec("DELETE FROM recurring_transactions WHERE id = ?", [id]);
}

export async function getDueRecurring(
  db: DbClient,
  date: string
): Promise<RecurringTransaction[]> {
  const { rows } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1 AND next_occurrence <= ?",
    [date]
  );
  return rows;
}

export async function autoPopulateFutureTransactions(
  db: DbClient,
  month: string
): Promise<void> {
  const { rows: recurring } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthStart = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  for (const rec of recurring) {
    // Check if a transaction already exists for this recurring rule in this month
    const { rows: existing } = await db.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions
       WHERE recurring_id = ? AND substr(date, 1, 7) = ?`,
      [rec.id, month]
    );

    if ((existing[0]?.count ?? 0) > 0) continue;

    // Check if this recurring rule has an occurrence in this month
    let occ = rec.start_date;
    // Advance to this month
    while (occ < monthStart) {
      occ = getNextOccurrence(occ, rec.frequency, rec.custom_interval_days);
      if (rec.end_date && occ > rec.end_date) break;
    }

    if (occ >= monthStart && occ <= monthEnd) {
      if (rec.end_date && occ > rec.end_date) continue;

      await db.exec(
        `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '')`,
        [
          crypto.randomUUID(),
          rec.amount,
          rec.type,
          rec.category_id,
          occ,
          rec.payee,
          rec.notes,
          rec.id,
        ]
      );
    }
  }
}
