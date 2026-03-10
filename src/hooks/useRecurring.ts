import { useState, useEffect, useCallback } from "react";
import { useDb } from "../context/DbContext.tsx";
import {
  getRecurringTransactions,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  processRecurringRules,
} from "../db/queries/recurring.ts";
import { emitDbEvent, onDbEvent } from "../lib/db-events.ts";
import { formatLocalDate } from "../lib/recurring.ts";
import type { RecurringTransaction } from "../types/database.ts";

export function useRecurring() {
  const db = useDb();
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await getRecurringTransactions(db);
    setItems(data);
    setLoading(false);
  }, [db]);

  useEffect(() => {
    refresh();
    return onDbEvent("recurring-changed", refresh);
  }, [refresh]);

  const add = useCallback(
    async (rec: {
      amount: number;
      type: "income" | "expense";
      category_id: string | null;
      payee?: string;
      notes?: string;
      frequency: RecurringTransaction["frequency"];
      custom_interval_days?: number | null;
      start_date: string;
      end_date?: string | null;
      mode?: "reminder" | "auto";
      is_variable?: boolean;
    }) => {
      const id = crypto.randomUUID();
      const anchorDay = ["monthly", "quarterly", "yearly"].includes(rec.frequency)
        ? parseInt(rec.start_date.slice(8, 10), 10)
        : null;
      await createRecurring(db, {
        id,
        ...rec,
        next_occurrence: rec.start_date,
        anchor_day: anchorDay,
        is_variable: rec.is_variable ? 1 : 0,
      });
      emitDbEvent("recurring-changed");

      // If the rule starts in the past, run scheduler to catch up
      const today = formatLocalDate(new Date());
      if (rec.start_date <= today) {
        const count = await processRecurringRules(db, today);
        if (count > 0) {
          emitDbEvent("transactions-changed");
        }
      }

      return id;
    },
    [db]
  );

  const update = useCallback(
    async (
      id: string,
      updates: Parameters<typeof updateRecurring>[2]
    ) => {
      await updateRecurring(db, id, updates);
      emitDbEvent("recurring-changed");
    },
    [db]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteRecurring(db, id);
      emitDbEvent("recurring-changed");
    },
    [db]
  );

  const stopRecurrence = useCallback(
    async (recurringId: string) => {
      await updateRecurring(db, recurringId, { is_active: false });
      emitDbEvent("recurring-changed");
    },
    [db]
  );

  return { items, loading, add, update, remove, stopRecurrence, refresh };
}
