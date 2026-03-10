import { useMemo, useCallback, useEffect } from "react";
import type { CashflowGroup, CashflowRow } from "../../../lib/cashflow.ts";
import type { Category } from "../../../types/database.ts";
import type { SingleMonthViewProps } from "../SingleMonthView.tsx";
import { GRID_COLS } from "./types.ts";
import { useTableState } from "./useTableState.ts";
import { useTableKeyboard } from "./useTableKeyboard.ts";
import { createActions } from "./actions.ts";
import { GroupBlock } from "./GroupBlock.tsx";
import { InlineAddRow } from "./InlineAddRow.tsx";
import { formatCurrency } from "../../../lib/format.ts";

interface TransactionTableProps {
  title: string;
  variant: "income" | "expense";
  total: number;
  groups: CashflowGroup[];
  month: string;
  categories?: Category[];
  onToggleStatus: SingleMonthViewProps["onToggleStatus"];
  onDeleteRow: SingleMonthViewProps["onDeleteRow"];
  onStopRecurrence?: SingleMonthViewProps["onStopRecurrence"];
  onEditRow: SingleMonthViewProps["onEditRow"];
  onAddRow: SingleMonthViewProps["onAddRow"];
  onDuplicateRow?: SingleMonthViewProps["onDuplicateRow"];
  onCreateCategory?: SingleMonthViewProps["onCreateCategory"];
  onAttachRecurrence?: SingleMonthViewProps["onAttachRecurrence"];
  onUpdateRecurringFrequency?: SingleMonthViewProps["onUpdateRecurringFrequency"];
  onSelectionChange?: (ids: Set<string>) => void;
  clearSelectionSignal?: number;
}

export function TransactionTable({
  title,
  variant,
  total,
  groups,
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
  onSelectionChange,
  clearSelectionSignal,
}: TransactionTableProps) {
  const { state, dispatch, hasSelection } = useTableState();

  const rowCount = groups.reduce((s, g) => s + g.rows.length, 0);

  const orderedRowIds = useMemo(
    () => groups.flatMap((g) => g.rows.map((r) => r.id)),
    [groups]
  );

  const rowMap = useMemo(() => {
    const map = new Map<string, CashflowRow>();
    for (const g of groups) for (const r of g.rows) map.set(r.id, r);
    return map;
  }, [groups]);

  const filteredCategories = useMemo(
    () => (categories ?? []).filter((c) => (variant === "income" ? c.is_income : !c.is_income)),
    [categories, variant]
  );

  const actions = useMemo(
    () =>
      createActions({
        onDeleteRow,
        onToggleStatus,
        onDuplicateRow: onDuplicateRow
          ? (id: string) => {
              const row = rowMap.get(id);
              if (row) onDuplicateRow(row);
            }
          : undefined,
        onEditCell: (rowId, col) => dispatch({ type: "EDIT_CELL", rowId, col }),
        getRow: (id) => {
          const r = rowMap.get(id);
          return r ? { status: r.status } : undefined;
        },
      }),
    [onDeleteRow, onToggleStatus, onDuplicateRow, rowMap, dispatch]
  );

  const getRow = useCallback((id: string) => rowMap.get(id), [rowMap]);

  const handleKeyDown = useTableKeyboard({
    state,
    dispatch,
    orderedRowIds,
    actions,
    getRow,
    onDuplicateRow,
  });

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(state.selectedIds);
  }, [state.selectedIds, onSelectionChange]);

  // Clear selection when parent requests it
  useEffect(() => {
    if (clearSelectionSignal) {
      dispatch({ type: "CLEAR_SELECTION" });
    }
  }, [clearSelectionSignal, dispatch]);

  // Stable callback for onCreateCategory wrapper passed to GroupBlock
  const handleCreateCategory = useCallback(
    onCreateCategory
      ? (name: string) => onCreateCategory(name, variant === "income")
      : undefined,
    [onCreateCategory, variant]
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${variant === "income" ? "text-success" : "text-danger"}`}>
            {title}
          </h3>
          <span className="text-[10px] font-medium text-text-light bg-surface-alt border border-border rounded-full px-1.5 py-0.5 tabular-nums leading-none">
            {rowCount}
          </span>
        </div>
        <span className={`text-xs font-bold tabular-nums ${variant === "income" ? "text-success" : "text-danger"}`}>
          {formatCurrency(total)}
        </span>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="rounded-xl border border-border bg-surface"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ outline: "none" }}
      >
        {/* Column header */}
        <div className={`grid ${GRID_COLS} gap-x-3 px-3 py-2 bg-surface-alt border-b border-border text-[10px] font-semibold text-text-light uppercase tracking-wider rounded-t-xl`}>
          <div className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={hasSelection && state.selectedIds.size === rowCount}
              ref={(el) => {
                if (el) el.indeterminate = hasSelection && state.selectedIds.size < rowCount;
              }}
              onChange={() => {
                if (state.selectedIds.size === rowCount) {
                  dispatch({ type: "CLEAR_SELECTION" });
                } else {
                  dispatch({ type: "SELECT_ALL", ids: orderedRowIds });
                }
              }}
              className="w-3.5 h-3.5 rounded border-border-dark accent-accent cursor-pointer"
              title="Select all"
            />
          </div>
          <span>Payee</span>
          <span className="text-center hidden sm:block">Date</span>
          <span className="text-center hidden sm:block">Category</span>
          <span className="text-center hidden sm:block">Recur</span>
          <span className="text-right">Amount</span>
          <span className="text-center">Status</span>
          <span />
        </div>

        {groups.map((group) => (
          <GroupBlock
            key={group.name || "__ungrouped"}
            group={group}
            focusedRowId={state.focusedRowId}
            editingCell={state.editingCell}
            selectedIds={state.selectedIds}
            hasSelection={hasSelection}
            orderedIds={orderedRowIds}
            categories={filteredCategories}
            dispatch={dispatch}
            onEditRow={onEditRow}
            onToggleStatus={onToggleStatus}
            onDeleteRow={onDeleteRow}
            onDuplicateRow={onDuplicateRow}
            onStopRecurrence={onStopRecurrence}
            onAttachRecurrence={onAttachRecurrence}
            onUpdateRecurringFrequency={onUpdateRecurringFrequency}
            onCreateCategory={handleCreateCategory}
          />
        ))}

        {/* Inline add */}
        <InlineAddRow
          type={variant}
          month={month}
          categories={categories}
          groups={groups}
          onAddRow={onAddRow}
          onCreateCategory={onCreateCategory}
        />
      </div>

    </div>
  );
}
