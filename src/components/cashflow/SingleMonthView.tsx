import { useMemo, useState, useCallback } from "react";
import type { CashflowGroup, CashflowRow, CashflowSummary } from "../../lib/cashflow.ts";
import type { Category, RecurringTransaction } from "../../types/database.ts";

import { SummaryStrip } from "./SummaryStrip.tsx";
import { ReviewBanner } from "./ReviewBanner.tsx";
import { TransactionTable } from "./table/TransactionTable.tsx";
import { BulkActionBar } from "./table/BulkActionBar.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";

export interface SingleMonthViewProps {
  incomeGroups: CashflowGroup[];
  expenseGroups: CashflowGroup[];
  summary: CashflowSummary;
  month: string;
  categories?: Category[];
  onToggleStatus: (id: string, newStatus: "planned" | "confirmed" | "review") => void;
  onDeleteRow: (id: string) => void;
  onStopRecurrence?: (recurringId: string) => void;
  onEditRow: (id: string, updates: { payee?: string; amount?: number; type?: "income" | "expense"; category_id?: string | null; date?: string; group_name?: string; status?: "planned" | "confirmed" | "review" }) => void;
  onAddRow: (data: {
    payee: string;
    type: "income" | "expense";
    amount: number;
    category_id: string | null;
    date: string;
    status: "planned" | "confirmed";
    group_name: string;
    recurring?: {
      frequency: RecurringTransaction["frequency"];
      custom_interval_days?: number | null;
      end_date?: string | null;
    };
  }) => void | Promise<void>;
  onDuplicateRow?: (row: CashflowRow) => void;
  onCreateCategory?: (name: string, isIncome: boolean) => Promise<string>;
  onAttachRecurrence?: (txnId: string, row: CashflowRow, frequency: RecurringTransaction["frequency"]) => void;
  onUpdateRecurringFrequency?: (recurringId: string, frequency: RecurringTransaction["frequency"]) => void;
  onBulkDeleteRows: (ids: string[]) => void | Promise<void>;
  onBulkEditRows: (ids: string[], updates: { status?: "planned" | "confirmed"; category_id?: string | null }) => void | Promise<void>;
}

export function SingleMonthView({
  incomeGroups,
  expenseGroups,
  summary,
  month,
  categories,
  onToggleStatus,
  onDeleteRow,
  onStopRecurrence,
  onEditRow,
  onAddRow,
  onDuplicateRow,
  onCreateCategory,
  onAttachRecurrence,
  onUpdateRecurringFrequency,
  onBulkDeleteRows,
  onBulkEditRows,
}: SingleMonthViewProps) {
  const [incomeSelectedIds, setIncomeSelectedIds] = useState<Set<string>>(new Set());
  const [expenseSelectedIds, setExpenseSelectedIds] = useState<Set<string>>(new Set());
  const [clearIncomeSig, setClearIncomeSig] = useState(0);
  const [clearExpenseSig, setClearExpenseSig] = useState(0);
  const [bulkDeletePending, setBulkDeletePending] = useState<string[]>([]);

  const hasIncomeSelection = incomeSelectedIds.size > 0;
  const hasExpenseSelection = expenseSelectedIds.size > 0;
  const hasAnySelection = hasIncomeSelection || hasExpenseSelection;
  const isMixed = hasIncomeSelection && hasExpenseSelection;

  const allSelectedIds = useMemo(
    () => new Set([...incomeSelectedIds, ...expenseSelectedIds]),
    [incomeSelectedIds, expenseSelectedIds]
  );

  // When mixed, hide Category (income/expense categories are not interchangeable)
  const bulkCategories = useMemo(() => {
    if (isMixed) return undefined;
    const isIncome = hasIncomeSelection;
    return (categories ?? []).filter((c) => (isIncome ? c.is_income : !c.is_income));
  }, [isMixed, hasIncomeSelection, categories]);

  const handleIncomeSelection = useCallback((ids: Set<string>) => setIncomeSelectedIds(ids), []);
  const handleExpenseSelection = useCallback((ids: Set<string>) => setExpenseSelectedIds(ids), []);

  const handleClearSelection = useCallback(() => {
    if (hasIncomeSelection) setClearIncomeSig((s) => s + 1);
    if (hasExpenseSelection) setClearExpenseSig((s) => s + 1);
  }, [hasIncomeSelection, hasExpenseSelection]);

  const reviewCount = useMemo(() => {
    let count = 0;
    for (const group of incomeGroups)
      for (const row of group.rows)
        if (row.status === "review") count++;
    for (const group of expenseGroups)
      for (const row of group.rows)
        if (row.status === "review") count++;
    return count;
  }, [incomeGroups, expenseGroups]);

  return (
    <div className="space-y-5">
      <SummaryStrip summary={summary} />
      <ReviewBanner count={reviewCount} />

      <TransactionTable
        title="Income"
        variant="income"
        total={summary.income}
        groups={incomeGroups}
        month={month}
        categories={categories}
        onToggleStatus={onToggleStatus}
        onDeleteRow={onDeleteRow}
        onStopRecurrence={onStopRecurrence}
        onEditRow={onEditRow}
        onAddRow={onAddRow}
        onDuplicateRow={onDuplicateRow}
        onCreateCategory={onCreateCategory}
        onAttachRecurrence={onAttachRecurrence}
        onUpdateRecurringFrequency={onUpdateRecurringFrequency}
        onSelectionChange={handleIncomeSelection}
        clearSelectionSignal={clearIncomeSig}
      />

      <TransactionTable
        title="Expenses"
        variant="expense"
        total={summary.expenses}
        groups={expenseGroups}
        month={month}
        categories={categories}
        onToggleStatus={onToggleStatus}
        onDeleteRow={onDeleteRow}
        onStopRecurrence={onStopRecurrence}
        onEditRow={onEditRow}
        onAddRow={onAddRow}
        onDuplicateRow={onDuplicateRow}
        onCreateCategory={onCreateCategory}
        onAttachRecurrence={onAttachRecurrence}
        onUpdateRecurringFrequency={onUpdateRecurringFrequency}
        onSelectionChange={handleExpenseSelection}
        clearSelectionSignal={clearExpenseSig}
      />

      {hasAnySelection && (
        <BulkActionBar
          selectedIds={allSelectedIds}
          categories={bulkCategories}
          onDelete={(ids) => setBulkDeletePending(ids)}
          onChangeStatus={(ids, status) => { void onBulkEditRows(ids, { status }); handleClearSelection(); }}
          onChangeCategory={(ids, catId) => { void onBulkEditRows(ids, { category_id: catId }); handleClearSelection(); }}
          onClearSelection={handleClearSelection}
        />
      )}

      <ConfirmDialog
        open={bulkDeletePending.length > 0}
        onClose={() => setBulkDeletePending([])}
        onConfirm={async () => {
          await onBulkDeleteRows(bulkDeletePending);
          setBulkDeletePending([]);
          handleClearSelection();
        }}
        title={`Delete ${bulkDeletePending.length} Transaction${bulkDeletePending.length !== 1 ? "s" : ""}`}
        message={`Delete ${bulkDeletePending.length} transaction${bulkDeletePending.length !== 1 ? "s" : ""}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
