import type { DbClient } from "../client.ts";
import type { TransactionWithCategory } from "./transactions.ts";
import { getToday } from "../../lib/format.ts";

/** Past transactions (date before today) are implicitly confirmed. */
function confirmPast(rows: TransactionWithCategory[]): TransactionWithCategory[] {
  const today = getToday();
  return rows.map((r) =>
    r.date < today ? { ...r, status: "confirmed" as const } : r
  );
}

export async function getTransactionsForMonth(
  db: DbClient,
  month: string
): Promise<TransactionWithCategory[]> {
  const { rows } = await db.exec<TransactionWithCategory>(
    `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
            r.frequency as recurring_frequency
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     LEFT JOIN recurring_transactions r ON t.recurring_id = r.id
     WHERE substr(t.date, 1, 7) = ?
     ORDER BY t.date DESC, t.created_at DESC`,
    [month]
  );
  return confirmPast(rows);
}

export async function getTransactionsForRange(
  db: DbClient,
  startMonth: string,
  endMonth: string
): Promise<TransactionWithCategory[]> {
  const { rows } = await db.exec<TransactionWithCategory>(
    `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
     ORDER BY t.date DESC, t.created_at DESC`,
    [startMonth, endMonth]
  );
  return confirmPast(rows);
}
