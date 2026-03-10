import type { DbClient } from "../client.ts";
import type { RecurringTransaction } from "../../types/database.ts";
import { getNextOccurrence, formatLocalDate } from "../../lib/recurring.ts";
import { ANCHOR_DAY_FREQUENCIES, SET_UPDATED_AT } from "../schema.ts";
import { createTransaction } from "./transactions.ts";

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
  // Auto-compute anchor_day for month-based frequencies if not explicitly provided
  const anchorDay = rec.anchor_day ??
    ((ANCHOR_DAY_FREQUENCIES as readonly string[]).includes(rec.frequency)
      ? parseInt(rec.start_date.slice(8, 10), 10)
      : null);

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
      anchorDay,
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
  sets.push(SET_UPDATED_AT);
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
    const [y, m] = monthStart.slice(0, 7).split("-").map(Number) as [number, number];
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(rule.anchor_day, maxDay);
    const occ = formatLocalDate(new Date(y, m - 1, day));

    // For quarterly: check if this month is a valid quarter step from start
    if (freq === "quarterly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      if ((m - startMonth + 12) % 3 !== 0) return null;
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

/** Process a single recurring rule: catch up missed occurrences and create planned future ones. */
async function processRule(db: DbClient, rule: RecurringTransaction, today: string): Promise<number> {
  const todayMonth = today.slice(0, 7);

  // Prefetch all existing transaction dates for this rule to avoid N+1 queries
  const { rows: existingRows } = await db.exec<{ date: string }>(
    "SELECT date FROM transactions WHERE recurring_id = ? AND date >= ?",
    [rule.id, rule.next_occurrence]
  );
  const existingDates = new Set(existingRows.map((r) => r.date));

  let occ = rule.next_occurrence;
  let deactivated = false;
  let generated = 0;

  // Catch up: generate for every missed occurrence up through today
  while (occ <= today) {
    if (rule.end_date && occ > rule.end_date) {
      await updateRecurring(db, rule.id, { is_active: false });
      deactivated = true;
      break;
    }

    if (!existingDates.has(occ)) {
      await createTransaction(db, {
        id: crypto.randomUUID(),
        amount: rule.amount,
        type: rule.type,
        category_id: rule.category_id,
        date: occ,
        payee: rule.payee,
        notes: rule.notes,
        recurring_id: rule.id,
        status: rule.is_variable ? "review" : "confirmed",
      });
      generated++;
    }

    occ = getNextOccurrence(occ, rule.frequency, rule.anchor_day, rule.custom_interval_days);
  }

  // Update next_occurrence to the advanced value
  if (!deactivated && occ !== rule.next_occurrence) {
    if (rule.end_date && occ > rule.end_date) {
      await updateRecurring(db, rule.id, { is_active: false });
    } else {
      await updateRecurring(db, rule.id, { next_occurrence: occ });
    }
  }

  // Current month future: if next_occurrence is in the current month but after today
  if (occ > today && occ.slice(0, 7) === todayMonth && !existingDates.has(occ)) {
    await createTransaction(db, {
      id: crypto.randomUUID(),
      amount: rule.amount,
      type: rule.type,
      category_id: rule.category_id,
      date: occ,
      payee: rule.payee,
      notes: rule.notes,
      recurring_id: rule.id,
      status: "planned",
    });
    generated++;
  }

  return generated;
}

/**
 * Runs once on app init. Catches up all missed recurring occurrences
 * from each rule's next_occurrence through today.
 */
export async function processRecurringRules(
  db: DbClient,
  today: string
): Promise<number> {
  const { rows: rules } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  let generated = 0;
  for (const rule of rules) {
    generated += await processRule(db, rule, today);
  }
  return generated;
}

/** Process a single recurring rule by ID (used after creating a new rule). */
export async function processRecurringRuleById(
  db: DbClient,
  ruleId: string,
  today: string
): Promise<number> {
  const { rows } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE id = ?",
    [ruleId]
  );
  if (rows.length === 0) return 0;
  return processRule(db, rows[0]!, today);
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
    // Compute occurrence for this month
    const occ = computeOccurrenceForMonth(rule, monthStart, monthEnd);
    if (!occ) continue;
    if (rule.end_date && occ > rule.end_date) continue;

    // Atomic insert: skip if any transaction already exists for this rule in this month.
    // This avoids race conditions with processRecurringRules running concurrently.
    const txnId = crypto.randomUUID();
    await db.exec(
      `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = ?
       )`,
      [
        txnId, rule.amount, rule.type, rule.category_id,
        occ, rule.payee, rule.notes, rule.id, "planned", "",
        rule.id, month,
      ]
    );
  }
}
