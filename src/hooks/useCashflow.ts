import { useState, useEffect, useCallback } from "react";
import { useDb } from "../context/DbContext.tsx";
import { getTransactionsForMonth } from "../db/queries/cashflow.ts";
import { createTransaction, updateTransaction, deleteTransaction } from "../db/queries/transactions.ts";
import { populateFutureMonth, createRecurring, updateRecurring } from "../db/queries/recurring.ts";
import { buildCashflowRows, type CashflowGroup, type CashflowSummary, type GroupBy } from "../lib/cashflow.ts";
import { emitDbEvent, onDbEvent } from "../lib/db-events.ts";
import type { TransactionWithCategory } from "../db/queries/transactions.ts";
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

  const refresh = useCallback(async () => {
    // Auto-populate planned transactions from recurring rules
    await populateFutureMonth(db, month);

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
      onDbEvent("recurring-changed", refresh),
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
        emitDbEvent("recurring-changed");
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
      return id;
    },
    [db]
  );

  const editTransaction = useCallback(
    async (id: string, updates: Parameters<typeof updateTransaction>[2]) => {
      await updateTransaction(db, id, updates);

      // Auto-confirm review transactions when edited
      if (!updates.status) {
        const txn = transactions.find((t) => t.id === id);
        if (txn?.status === "review") {
          await updateTransaction(db, id, { status: "confirmed" });
          // Update the recurring rule's default amount
          if (txn.recurring_id && updates.amount !== undefined) {
            await updateRecurring(db, txn.recurring_id, { amount: updates.amount });
            emitDbEvent("recurring-changed");
          }
        }
      }

      emitDbEvent("transactions-changed");
    },
    [db, transactions]
  );

  const removeTransaction = useCallback(
    async (id: string) => {
      await deleteTransaction(db, id);
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
  };
}
