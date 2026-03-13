import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { useRecurring } from "../hooks/useRecurring.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { formatCurrency } from "../lib/format.ts";
import { monthlyEquivalent } from "../lib/recurring.ts";
import { RecurringTable } from "../components/recurring/table/RecurringTable.tsx";

export const Route = createFileRoute("/recurring")({
  component: RecurringPage,
});

function RecurringPage() {
  const { items, loading, add, remove, stopRecurrence, resumeRecurrence, updateRuleAndSync } = useRecurring();
  const { categories, add: addCategory } = useCategories();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const activeIncome = items.filter((r) => r.is_active && r.type === "income");
  const activeExpense = items.filter((r) => r.is_active && r.type === "expense");
  const inactive = items.filter((r) => !r.is_active);
  const inactiveIncome = inactive.filter((r) => r.type === "income");
  const inactiveExpense = inactive.filter((r) => r.type === "expense");
  const incomeTotal = activeIncome.reduce(
    (s, r) => s + monthlyEquivalent(r.amount, r.frequency, r.custom_interval_days), 0
  );
  const expenseTotal = activeExpense.reduce(
    (s, r) => s + monthlyEquivalent(r.amount, r.frequency, r.custom_interval_days), 0
  );

  const handleCreateCategory = useCallback(
    async (name: string, isIncome: boolean) => {
      const id = await addCategory({ name, color: "#64748b", is_income: isIncome });
      return id;
    },
    [addCategory]
  );

  const handleAdd = useCallback(async (data: {
    amount: number;
    type: "income" | "expense";
    category_id: string | null;
    payee: string;
    notes: string;
    frequency: import("../types/database.ts").RecurringTransaction["frequency"];
    start_date: string;
    end_date: string | null;
    mode: "auto";
    is_variable?: boolean;
  }) => {
    await add(data);
    toast("Recurring rule created");
  }, [add, toast]);

  const handleEditField = useCallback(async (id: string, updates: Record<string, unknown>) => {
    await updateRuleAndSync(id, updates);
    toast("Rule updated");
  }, [updateRuleAndSync, toast]);

  const handleToggleActive = useCallback(async (id: string) => {
    const item = items.find((r) => r.id === id);
    if (!item) return;
    if (item.is_active) {
      await stopRecurrence(id);
      toast("Recurring rule paused");
    } else {
      await resumeRecurrence(id);
      toast("Recurring rule resumed");
    }
  }, [items, stopRecurrence, resumeRecurrence, toast]);

  const handleDelete = useCallback((id: string) => {
    setDeleteId(id);
  }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="Recurring" />
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Recurring" />

      <RecurringSummary income={incomeTotal} expenses={expenseTotal} />

      <div className="mb-5">
        <RecurringTable
          type="income"
          items={activeIncome}
          total={incomeTotal}
          categories={categories}
          onEditField={handleEditField}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          onAdd={handleAdd}
          onCreateCategory={handleCreateCategory}
        />
      </div>

      <div className="mb-5">
        <RecurringTable
          type="expense"
          items={activeExpense}
          total={expenseTotal}
          categories={categories}
          onEditField={handleEditField}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          onAdd={handleAdd}
          onCreateCategory={handleCreateCategory}
        />
      </div>

      {/* Inactive rules — split by type */}
      {inactive.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text transition-colors cursor-pointer mb-2"
          >
            <svg className={`w-4 h-4 transition-transform ${showInactive ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
            Inactive ({inactive.length})
          </button>

          {showInactive && (
            <div className="space-y-4">
              {inactiveIncome.length > 0 && (
                <RecurringTable
                  type="income"
                  items={inactiveIncome}
                  total={0}
                  categories={categories}
                  onEditField={handleEditField}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                  onAdd={handleAdd}
                  onCreateCategory={handleCreateCategory}
                  inactive
                />
              )}
              {inactiveExpense.length > 0 && (
                <RecurringTable
                  type="expense"
                  items={inactiveExpense}
                  total={0}
                  categories={categories}
                  onEditField={handleEditField}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                  onAdd={handleAdd}
                  onCreateCategory={handleCreateCategory}
                  inactive
                />
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (deleteId) {
            await remove(deleteId);
            toast("Rule deleted");
          }
        }}
        title="Delete recurring rule"
        message="This will delete the rule permanently. Existing transactions created by this rule will remain."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}

// --- Summary ---

function RecurringSummary({ income, expenses }: { income: number; expenses: number }) {
  const net = income - expenses;
  return (
    <div className="flex items-stretch gap-3 overflow-x-auto mb-5">
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Monthly Income</div>
        <div className="text-lg font-bold tabular-nums text-success">{formatCurrency(income)}</div>
        <div className="text-[10px] text-text-light">projected / month</div>
      </div>
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Monthly Expenses</div>
        <div className="text-lg font-bold tabular-nums">{formatCurrency(expenses)}</div>
        <div className="text-[10px] text-text-light">projected / month</div>
      </div>
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Net</div>
        <div className={`text-lg font-bold tabular-nums ${net >= 0 ? "text-success" : "text-danger"}`}>
          {net >= 0 ? "+" : ""}{formatCurrency(Math.abs(net))}
        </div>
        <div className="text-[10px] text-text-light">projected / month</div>
      </div>
    </div>
  );
}
