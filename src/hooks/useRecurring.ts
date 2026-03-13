import { useState, useEffect, useCallback } from "react";
import { useDb } from "../context/DbContext.tsx";
import {
  getRecurringTransactions,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  processRecurringRuleById,
} from "../db/queries/recurring.ts";
import {
  deleteFutureInstancesOfRule,
  updateFutureInstancesOfRule,
} from "../db/queries/transactions.ts";
import { emitDbEvent, onDbEvent } from "../lib/db-events.ts";
import { getToday } from "../lib/format.ts";
import { getNextOccurrence } from "../lib/recurring.ts";
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
      await createRecurring(db, {
        id,
        ...rec,
        next_occurrence: rec.start_date,
        is_variable: rec.is_variable ? 1 : 0,
      });
      emitDbEvent("recurring-changed");

      // If the rule starts in the past or today, run scheduler to catch up
      const today = getToday();
      if (rec.start_date <= today) {
        const count = await processRecurringRuleById(db, id, today);
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
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  const stopRecurrence = useCallback(
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
   * Update a recurring rule and sync future planned/review instances.
   * For frequency/start_date/end_date changes, deletes + regenerates future instances.
   * For payee/amount/category changes, bulk-updates existing future instances.
   */
  const updateRuleAndSync = useCallback(
    async (ruleId: string, updates: Parameters<typeof updateRecurring>[2]) => {
      const today = getToday();
      const isScheduleChange =
        updates.frequency !== undefined ||
        updates.start_date !== undefined ||
        updates.end_date !== undefined;

      await updateRecurring(db, ruleId, updates);

      if (isScheduleChange) {
        // Delete future instances and regenerate under new schedule
        await deleteFutureInstancesOfRule(db, ruleId, today);
        await processRecurringRuleById(db, ruleId, today);
      } else {
        // Sync scalar fields on future instances
        const instanceUpdates: Parameters<typeof updateFutureInstancesOfRule>[3] = {};
        if (updates.amount !== undefined) instanceUpdates.amount = updates.amount;
        if (updates.payee !== undefined) instanceUpdates.payee = updates.payee;
        if (updates.category_id !== undefined) instanceUpdates.category_id = updates.category_id;
        if (Object.keys(instanceUpdates).length > 0) {
          await updateFutureInstancesOfRule(db, ruleId, today, instanceUpdates);
        }
      }

      emitDbEvent("recurring-changed");
      emitDbEvent("transactions-changed");
    },
    [db]
  );

  const resumeRecurrence = useCallback(
    async (recurringId: string) => {
      const today = getToday();
      // Check if rule ended (end_date in the past) — if so, clear end_date and reset next_occurrence
      const rule = items.find((r) => r.id === recurringId);
      const updates: Parameters<typeof updateRecurring>[2] = { is_active: true };
      if (rule?.end_date && rule.end_date < today) {
        updates.end_date = null;
        // Compute the first valid future occurrence respecting the rule's cadence
        let occ = today;
        if (rule.frequency) {
          occ = getNextOccurrence(today, rule.frequency, rule.anchor_day, rule.custom_interval_days);
          // If today itself is a valid occurrence date (matches anchor), use today
          if (rule.anchor_day && parseInt(today.slice(8, 10), 10) === rule.anchor_day) {
            occ = today;
          }
        }
        updates.next_occurrence = occ;
      }
      await updateRecurring(db, recurringId, updates);
      const count = await processRecurringRuleById(db, recurringId, today);
      emitDbEvent("recurring-changed");
      if (count > 0) emitDbEvent("transactions-changed");
    },
    [db, items]
  );

  return { items, loading, add, update, remove, stopRecurrence, resumeRecurrence, updateRuleAndSync, refresh };
}
