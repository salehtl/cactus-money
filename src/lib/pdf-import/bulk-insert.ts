import type { DbClient } from "../../db/client.ts";
import type { ParsedTransaction } from "./types.ts";
import { emitDbEvent } from "../db-events.ts";

/** Normalized fingerprint for duplicate detection: date|amount|payee_lower_trimmed */
export function txnFingerprint(date: string, amount: number, payee: string): string {
  return `${date}|${amount}|${payee.toLowerCase().trim()}`;
}

/**
 * Build a Set of fingerprints from existing DB transactions within a date range.
 * Used to detect duplicates before import.
 */
export async function getExistingFingerprints(
  db: DbClient,
  minDate: string,
  maxDate: string,
): Promise<Set<string>> {
  const { rows } = await db.exec<{ date: string; amount: number; payee: string }>(
    `SELECT date, amount, payee FROM transactions WHERE date >= ? AND date <= ?`,
    [minDate, maxDate],
  );
  const set = new Set<string>();
  for (const r of rows) {
    set.add(txnFingerprint(r.date, r.amount, r.payee));
  }
  return set;
}

export async function bulkInsertTransactions(
  db: DbClient,
  transactions: ParsedTransaction[],
): Promise<number> {
  const selected = transactions.filter((t) => t.selected);
  if (selected.length === 0) return 0;

  await db.exec("BEGIN TRANSACTION;");
  try {
    for (const t of selected) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.exec(
        `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '', ?, ?)`,
        [id, t.amount, t.type, t.category_id, t.date, t.payee, t.notes, t.recurring_id ?? null, now, now],
      );
    }
    await db.exec("COMMIT;");
  } catch (e) {
    await db.exec("ROLLBACK;");
    throw e;
  }

  emitDbEvent("transactions-changed");
  return selected.length;
}
