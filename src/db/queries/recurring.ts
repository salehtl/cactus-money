import type { DbClient } from "../client.ts";
import type { RecurringTransaction } from "../../types/database.ts";
import { getNextOccurrence, formatLocalDate } from "../../lib/recurring.ts";

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
    anchor_day?: number | null;
    is_variable?: number;
  }
): Promise<void> {
  await db.exec(
    `INSERT INTO recurring_transactions
     (id, amount, type, category_id, payee, notes, frequency, custom_interval_days, start_date, end_date, next_occurrence, mode, anchor_day, is_variable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      rec.anchor_day ?? null,
      rec.is_variable ?? 0,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function transactionExists(db: DbClient, recurringId: string, date: string): Promise<boolean> {
  const { rows } = await db.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM transactions WHERE recurring_id = ? AND date = ?",
    [recurringId, date]
  );
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Given a recurring rule, compute the specific date it falls on
 * within [monthStart, monthEnd], or null if no occurrence.
 */
function computeOccurrenceForMonth(
  rule: RecurringTransaction,
  monthStart: string,
  monthEnd: string
): string | null {
  const freq = rule.frequency;

  // For month-based frequencies with anchor_day, direct calculation
  if ((freq === "monthly" || freq === "quarterly" || freq === "yearly") && rule.anchor_day) {
    const [y, m] = monthStart.split("-").map(Number) as [number, number];
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(rule.anchor_day, maxDay);
    const occ = `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;

    // For quarterly: check if this month is a valid quarter step from start
    if (freq === "quarterly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      const thisMonth = m;
      if ((thisMonth - startMonth + 12) % 3 !== 0) return null;
    }
    // For yearly: check if this is the correct month
    if (freq === "yearly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      if (m !== startMonth) return null;
    }

    if (occ >= monthStart && occ <= monthEnd && occ >= rule.start_date) return occ;
    return null;
  }

  // For day-based frequencies: step forward from next_occurrence
  let occ = rule.next_occurrence;
  while (occ < monthStart) {
    occ = getNextOccurrence(occ, freq, rule.anchor_day, rule.custom_interval_days);
    if (rule.end_date && occ > rule.end_date) return null;
  }

  if (occ >= monthStart && occ <= monthEnd) return occ;
  return null;
}

// ---------------------------------------------------------------------------
// New scheduler functions
// ---------------------------------------------------------------------------

/**
 * Runs once on app init. Catches up all missed recurring occurrences
 * from each rule's next_occurrence through today. Creates transactions
 * with appropriate status (confirmed, review, or planned).
 */
export async function processRecurringRules(
  db: DbClient,
  today: string
): Promise<number> {
  const { rows: rules } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  let generated = 0;
  const todayMonth = today.slice(0, 7);

  for (const rule of rules) {
    let occ = rule.next_occurrence;

    // Catch up: generate for every missed occurrence up through today
    while (occ <= today) {
      if (rule.end_date && occ > rule.end_date) {
        await updateRecurring(db, rule.id, { is_active: false });
        break;
      }

      const exists = await transactionExists(db, rule.id, occ);
      if (!exists) {
        const status = rule.is_variable ? "review" : "confirmed";
        await db.exec(
          `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
          [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id, status]
        );
        generated++;
      }

      const next = getNextOccurrence(occ, rule.frequency, rule.anchor_day, rule.custom_interval_days);
      occ = next;
    }

    // Update next_occurrence to the advanced value
    if (occ !== rule.next_occurrence) {
      if (rule.end_date && occ > rule.end_date) {
        await updateRecurring(db, rule.id, { is_active: false });
      } else {
        await updateRecurring(db, rule.id, { next_occurrence: occ });
      }
    }

    // Current month future: if next_occurrence is in the current month but after today
    if (occ > today && occ.slice(0, 7) === todayMonth) {
      const exists = await transactionExists(db, rule.id, occ);
      if (!exists) {
        await db.exec(
          `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '')`,
          [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id]
        );
        generated++;
      }
    }
  }

  return generated;
}

/**
 * For navigating to a future month: generates 'planned' transactions
 * for any recurring rules that have an occurrence in that month.
 */
export async function populateFutureMonth(
  db: DbClient,
  month: string
): Promise<void> {
  const { rows: rules } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthStart = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  for (const rule of rules) {
    // Check if transaction already exists for this rule in this month
    const { rows: existing } = await db.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = ?`,
      [rule.id, month]
    );
    if ((existing[0]?.count ?? 0) > 0) continue;

    // Compute occurrence for this month
    const occ = computeOccurrenceForMonth(rule, monthStart, monthEnd);
    if (!occ) continue;
    if (rule.end_date && occ > rule.end_date) continue;

    await db.exec(
      `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '')`,
      [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id]
    );
  }
}
