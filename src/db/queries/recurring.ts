import type { DbClient } from "../client.ts";
import type { RecurringTransaction } from "../../types/database.ts";
import { getNextOccurrence, computeOccurrencesForMonth } from "../../lib/recurring.ts";
import { getToday } from "../../lib/format.ts";
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
    anchor_day: number | null;
  }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  // When frequency or start_date changes, recompute anchor_day automatically
  // unless the caller already provides an explicit anchor_day
  if ((updates.frequency !== undefined || updates.start_date !== undefined) && updates.anchor_day === undefined) {
    const { rows } = await db.exec<{ frequency: string; start_date: string; next_occurrence: string }>(
      "SELECT frequency, start_date, next_occurrence FROM recurring_transactions WHERE id = ?",
      [id]
    );
    if (rows[0]) {
      const newFreq = updates.frequency ?? rows[0].frequency;
      const newStart = updates.start_date ?? rows[0].start_date;
      updates = {
        ...updates,
        anchor_day: (ANCHOR_DAY_FREQUENCIES as readonly string[]).includes(newFreq)
          ? parseInt(newStart.slice(8, 10), 10)
          : null,
      };
      // Also recompute next_occurrence from today when frequency changes (unless explicitly provided)
      if (updates.frequency !== undefined && updates.next_occurrence === undefined) {
        const today = getToday();
        let occ = rows[0].next_occurrence;
        // Advance from current next_occurrence until we're at/after today
        while (occ < today) {
          occ = getNextOccurrence(occ, newFreq as RecurringTransaction["frequency"], updates.anchor_day, updates.custom_interval_days ?? null);
        }
        updates = { ...updates, next_occurrence: occ };
      }
    }
  }

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
    "anchor_day",
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
      deactivated = true;
    } else {
      await updateRecurring(db, rule.id, { next_occurrence: occ });
    }
  }

  // Generate planned transactions for ALL remaining current-month occurrences
  if (!deactivated) {
    while (occ.slice(0, 7) === todayMonth) {
      if (rule.end_date && occ > rule.end_date) break;
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
          status: "planned",
        });
        generated++;
      }
      occ = getNextOccurrence(occ, rule.frequency, rule.anchor_day, rule.custom_interval_days);
    }
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
 * for any recurring rules that have occurrences in that month.
 * Now generates ALL occurrences (e.g. 4-5 for weekly rules).
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
    const occurrences = computeOccurrencesForMonth(rule, monthStart, monthEnd);
    if (occurrences.length === 0) continue;

    for (const occ of occurrences) {
      // Per-date dedup: only insert if no transaction exists for this rule on this exact date
      const txnId = crypto.randomUUID();
      await db.exec(
        `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM transactions WHERE recurring_id = ? AND date = ?
         )`,
        [
          txnId, rule.amount, rule.type, rule.category_id,
          occ, rule.payee, rule.notes, rule.id, "planned", "",
          rule.id, occ,
        ]
      );
    }
  }
}
