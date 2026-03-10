import { useState, useEffect, useCallback, useRef } from "react";
import { useDb } from "../context/DbContext.tsx";
import { getTransactionsForMonth } from "../db/queries/cashflow.ts";
import { createTransaction, updateTransaction, deleteTransaction, deleteTransactionsBatch, updateTransactionsBatch, deleteFutureInstancesOfRule, updateFutureInstancesOfRule } from "../db/queries/transactions.ts";
import { populateFutureMonth, createRecurring, updateRecurring, processRecurringRuleById } from "../db/queries/recurring.ts";
import { buildCashflowRows, type CashflowGroup, type CashflowSummary, type GroupBy } from "../lib/cashflow.ts";
import { emitDbEvent, onDbEvent } from "../lib/db-events.ts";
import { getNextOccurrence, formatLocalDate } from "../lib/recurring.ts";
import { getToday } from "../lib/format.ts";
import { ANCHOR_DAY_FREQUENCIES } from "../db/schema.ts";
import type { TransactionWithCategory } from "../db/queries/transactions.ts";
import type { CashflowRow } from "../lib/cashflow.ts";
import type { RecurringTransaction } from "../types/database.ts";

export function useCashflow(month: string, groupBy: GroupBy = "none") {
  const db = useDb();
  const [transactions, setTransactions] = useState<TransactionWithCategory[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<CashflowGroup[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<CashflowGroup[]>([]);
  const [summary, setSummary] = useState<CashflowSummary>({
    income: 0, expenses: 0, net: 0,
    plannedIncome: 0, confirmedIncome: 0,
    plannedExpenses: 0, confirmedExpenses: 0,
  });
  const [loading, setLoading] = useState(true);
  const populatedMonthRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    // Auto-populate planned transactions from recurring rules (once per month)
    if (populatedMonthRef.current !== month) {
      await populateFutureMonth(db, month);
      populatedMonthRef.current = month;
    }

    const txns = await getTransactionsForMonth(db, month);
    setTransactions(txns);

    const result = buildCashflowRows(txns, groupBy);
    setIncomeGroups(result.incomeGroups);
    setExpenseGroups(result.expenseGroups);
    setSummary(result.summary);
    setLoading(false);
  }, [db, month, groupBy]);

  useEffect(() => {
    refresh();
    const unsubs = [
      onDbEvent("transactions-changed", refresh),
      onDbEvent("recurring-changed", () => {
        populatedMonthRef.current = null; // force re-population
        refresh();
      }),
      onDbEvent("categories-changed", refresh),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [refresh]);

  const addTransaction = useCallback(
    async (txn: {
      amount: number;
      type: "income" | "expense";
      category_id: string | null;
      date: string;
      payee?: string;
      notes?: string;
      status?: "planned" | "confirmed";
      group_name?: string;
      recurring?: {
        frequency: RecurringTransaction["frequency"];
        custom_interval_days?: number | null;
        end_date?: string | null;
      };
    }) => {
      const id = crypto.randomUUID();
      let recurringId: string | null = null;

      if (txn.recurring) {
        recurringId = crypto.randomUUID();
        await createRecurring(db, {
          id: recurringId,
          amount: txn.amount,
          type: txn.type,
          category_id: txn.category_id,
          payee: txn.payee,
          notes: txn.notes,
          frequency: txn.recurring.frequency,
          custom_interval_days: txn.recurring.custom_interval_days,
          start_date: txn.date,
          end_date: txn.recurring.end_date,
          next_occurrence: txn.date,
          mode: "auto",
        });
      }

      await createTransaction(db, {
        id,
        amount: txn.amount,
        type: txn.type,
        category_id: txn.category_id,
        date: txn.date,
        payee: txn.payee,
        notes: txn.notes,
        status: txn.status ?? "confirmed",
        group_name: txn.group_name,
        recurring_id: recurringId,
      });
      emitDbEvent("transactions-changed");
      if (recurringId) emitDbEvent("recurring-changed");
      return id;
    },
    [db]
  );

  const editTransaction = useCallback(
    async (id: string, updates: Parameters<typeof updateTransaction>[2]) => {
      // Check if this is a review transaction that should be auto-confirmed
      let shouldAutoConfirm = false;
      let recurringId: string | null = null;
      if (!updates.status) {
        const { rows } = await db.exec<{ status: string; recurring_id: string | null }>(
          "SELECT status, recurring_id FROM transactions WHERE id = ?",
          [id]
        );
        if (rows[0]?.status === "review") {
          shouldAutoConfirm = true;
          recurringId = rows[0].recurring_id;
        }
      }

      await updateTransaction(db, id, {
        ...updates,
        ...(shouldAutoConfirm ? { status: "confirmed" as const } : {}),
      });

      // Update the recurring rule's default amount
      if (shouldAutoConfirm && recurringId && updates.amount !== undefined) {
        await updateRecurring(db, recurringId, { amount: updates.amount });
        emitDbEvent("recurring-changed");
      }

      emitDbEvent("transactions-changed");
    },
    [db]
  );

  const removeTransaction = useCallback(
    async (id: string) => {
      await deleteTransaction(db, id);
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  const removeTransactions = useCallback(
    async (ids: string[]) => {
      await deleteTransactionsBatch(db, ids);
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  const bulkEditTransactions = useCallback(
    async (ids: string[], updates: { status?: "planned" | "confirmed"; category_id?: string | null }) => {
      await updateTransactionsBatch(db, ids, updates);
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  /** Stop a recurring rule and purge all future planned/review instances. */
  const stopAndPurgeRecurrence = useCallback(
    async (recurringId: string) => {
      const today = getToday();
      await updateRecurring(db, recurringId, { is_active: false });
      await deleteFutureInstancesOfRule(db, recurringId, today);
      emitDbEvent("recurring-changed");
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  /**
   * Attach a frequency to a standalone transaction, creating a recurring rule
   * and linking the transaction as the first instance.
   */
  const attachRecurrence = useCallback(
    async (txnId: string, row: CashflowRow, frequency: RecurringTransaction["frequency"]) => {
      const ruleId = crypto.randomUUID();
      const anchorDay = (ANCHOR_DAY_FREQUENCIES as readonly string[]).includes(frequency)
        ? parseInt(row.date.slice(8, 10), 10)
        : null;
      await createRecurring(db, {
        id: ruleId,
        amount: row.amount,
        type: row.type,
        category_id: row.categoryId,
        payee: row.label,
        frequency,
        start_date: row.date,
        next_occurrence: row.date,
        anchor_day: anchorDay,
        mode: "reminder",
      });
      // Link this transaction as the first instance
      await updateTransaction(db, txnId, { recurring_id: ruleId } as Parameters<typeof updateTransaction>[2]);
      // Advance next_occurrence past this first instance
      const nextOcc = getNextOccurrence(row.date, frequency, anchorDay);
      await updateRecurring(db, ruleId, { next_occurrence: nextOcc });
      emitDbEvent("recurring-changed");
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  /**
   * Change the frequency on an existing recurring rule (from Recur column).
   * Deletes future instances and regenerates under new schedule.
   */
  const updateRecurringFrequency = useCallback(
    async (recurringId: string, newFrequency: RecurringTransaction["frequency"]) => {
      const today = getToday();
      await updateRecurring(db, recurringId, { frequency: newFrequency });
      await deleteFutureInstancesOfRule(db, recurringId, today);
      await processRecurringRuleById(db, recurringId, today);
      emitDbEvent("recurring-changed");
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  /**
   * Edit a field on a recurring instance with scope control.
   * 'one' — only update this instance.
   * 'all' — update this instance + the rule template + all future planned/review instances.
   */
  const editRecurringInstance = useCallback(
    async (
      txnId: string,
      recurringId: string,
      field: "payee" | "amount" | "date" | "category_id",
      value: unknown,
      scope: "one" | "all"
    ) => {
      const today = getToday();

      if (scope === "all" && field === "date") {
        // Fetch old date BEFORE updating so we can compute the delta
        const { rows: beforeRows } = await db.exec<{ date: string }>(
          "SELECT date FROM transactions WHERE id = ?",
          [txnId]
        );
        await updateTransaction(db, txnId, { date: value as string } as Parameters<typeof updateTransaction>[2]);

        const { rows: ruleRows } = await db.exec<{ next_occurrence: string }>(
          "SELECT next_occurrence FROM recurring_transactions WHERE id = ?",
          [recurringId]
        );
        if (beforeRows[0] && ruleRows[0]) {
          const oldDate = beforeRows[0].date;
          const newDate = value as string;
          const daysDelta = Math.round(
            (new Date(newDate + "T00:00:00").getTime() - new Date(oldDate + "T00:00:00").getTime()) / 86400000
          );
          const oldNextDate = new Date(ruleRows[0].next_occurrence + "T00:00:00");
          oldNextDate.setDate(oldNextDate.getDate() + daysDelta);
          await updateRecurring(db, recurringId, { next_occurrence: formatLocalDate(oldNextDate) });
          // Shift all future planned/review instances
          await db.exec(
            `UPDATE transactions SET date = date(date, ? || ' days'), updated_at = datetime('now')
             WHERE recurring_id = ? AND status IN ('planned', 'review') AND date > ?`,
            [`${daysDelta}`, recurringId, today]
          );
        }
        emitDbEvent("recurring-changed");
        emitDbEvent("transactions-changed");
        return;
      }

      await updateTransaction(db, txnId, { [field]: value } as Parameters<typeof updateTransaction>[2]);

      if (scope === "all") {
        // Update rule template
        await updateRecurring(db, recurringId, { [field]: value } as Parameters<typeof updateRecurring>[2]);
        // Sync future instances
        const instanceUpdates: Parameters<typeof updateFutureInstancesOfRule>[3] = {};
        if (field === "amount") instanceUpdates.amount = value as number;
        if (field === "payee") instanceUpdates.payee = value as string;
        if (field === "category_id") instanceUpdates.category_id = value as string | null;
        if (Object.keys(instanceUpdates).length > 0) {
          await updateFutureInstancesOfRule(db, recurringId, today, instanceUpdates);
        }
        emitDbEvent("recurring-changed");
      }

      emitDbEvent("transactions-changed");
    },
    [db]
  );

  return {
    transactions,
    incomeGroups,
    expenseGroups,
    summary,
    loading,
    refresh,
    addTransaction,
    editTransaction,
    removeTransaction,
    removeTransactions,
    bulkEditTransactions,
    stopAndPurgeRecurrence,
    attachRecurrence,
    updateRecurringFrequency,
    editRecurringInstance,
  };
}
