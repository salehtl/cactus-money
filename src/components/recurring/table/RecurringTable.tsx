import { useMemo, useCallback } from "react";
import type { RecurringTransaction, Category } from "../../../types/database.ts";
import { RECURRING_GRID_COLS, RECURRING_COLUMNS, RECURRING_COLUMN_INDEX, RECURRING_TABLE_CONFIG } from "./types.ts";
import { useTableState } from "../../cashflow/table/useTableState.ts";
import { useTableKeyboard } from "../../cashflow/table/useTableKeyboard.ts";
import { createRecurringActions } from "./actions.ts";
import { RecurringRow } from "./RecurringRow.tsx";
import { RecurringInlineAddRow } from "./RecurringInlineAddRow.tsx";
import { RecurringBulkActionBar } from "./RecurringBulkActionBar.tsx";
import { formatCurrency } from "../../../lib/format.ts";

interface RecurringTableProps {
  type: "income" | "expense";
  items: RecurringTransaction[];
  total: number;
  categories: Category[];
  onEditField: (id: string, updates: Record<string, unknown>) => void;
  onToggleActive: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (data: {
    amount: number;
    type: "income" | "expense";
    category_id: string | null;
    payee: string;
    notes: string;
    frequency: RecurringTransaction["frequency"];
    start_date: string;
    end_date: string | null;
    mode: "auto";
    is_variable?: boolean;
  }) => Promise<void>;
  onBulkDelete?: (ids: string[]) => void;
  onCreateCategory?: (name: string, isIncome: boolean) => Promise<string>;
  inactive?: boolean;
}

export function RecurringTable({
  type,
  items,
  total,
  categories,
  onEditField,
  onToggleActive,
  onDelete,
  onBulkDelete,
  onAdd,
  onCreateCategory,
  inactive,
}: RecurringTableProps) {
  const { state, dispatch, hasSelection } = useTableState(RECURRING_TABLE_CONFIG);
  const isIncome = type === "income";

  const orderedRowIds = useMemo(() => items.map((r) => r.id), [items]);

  const rowMap = useMemo(() => {
    const map = new Map<string, RecurringTransaction>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const filteredCategories = useMemo(
    () => categories.filter((c) => (isIncome ? c.is_income : !c.is_income)),
    [categories, isIncome]
  );

  const actions = useMemo(
    () => createRecurringActions({
      onDelete,
      onToggleActive,
      onEditCell: (rowId, col) => dispatch({ type: "EDIT_CELL", rowId, col }),
    }),
    [onDelete, onToggleActive, dispatch]
  );

  // useTableKeyboard needs getRow returning CashflowRow-shaped — we just need it for the type
  // Since recurring doesn't use copy/paste, we pass a no-op getRow
  const getRow = useCallback(() => undefined, []);

  const handleKeyDown = useTableKeyboard({
    state,
    dispatch,
    orderedRowIds,
    actions,
    columnsCount: RECURRING_COLUMNS.length,
    defaultEditCol: RECURRING_COLUMN_INDEX.payee,
    getRow,
  });

  const handleCreateCategory = useMemo(
    () => onCreateCategory
      ? (name: string) => onCreateCategory(name, isIncome)
      : undefined,
    [onCreateCategory, isIncome]
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${isIncome ? "text-success" : "text-danger"}`}>
            {isIncome ? "Income" : "Expenses"}
          </h3>
          <span className="text-[10px] font-medium text-text-light bg-surface-alt border border-border rounded-full px-1.5 py-0.5 tabular-nums leading-none">
            {items.length}
          </span>
        </div>
        <span className={`text-xs font-bold tabular-nums ${isIncome ? "text-success" : "text-danger"}`}>
          {formatCurrency(total)}
        </span>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={`rounded-xl border border-border bg-surface ${inactive ? "opacity-75" : ""}`}
        tabIndex={inactive ? undefined : 0}
        onKeyDown={inactive ? undefined : handleKeyDown}
        style={{ outline: "none" }}
      >
        {/* Column header */}
        <div className={`grid ${RECURRING_GRID_COLS} gap-x-3 px-3 py-2 bg-surface-alt border-b border-border text-[10px] font-semibold text-text-light uppercase tracking-wider rounded-t-xl`}>
          <div className="flex items-center justify-center">
            {!inactive && (
              <input
                type="checkbox"
                checked={hasSelection && state.selectedIds.size === items.length}
                ref={(el) => {
                  if (el) el.indeterminate = hasSelection && state.selectedIds.size < items.length;
                }}
                onChange={() => {
                  if (state.selectedIds.size === items.length) {
                    dispatch({ type: "CLEAR_SELECTION" });
                  } else {
                    dispatch({ type: "SELECT_ALL", ids: orderedRowIds });
                  }
                }}
                className="w-3.5 h-3.5 rounded border-border-dark accent-accent cursor-pointer"
                title="Select all"
              />
            )}
          </div>
          <span>Payee</span>
          <span className="text-right hidden sm:block">Amount</span>
          <span className="text-center hidden sm:block">Recur</span>
          <span className="text-center hidden sm:block">Category</span>
          <span className="text-center hidden sm:block">Start</span>
          <span className="text-center hidden sm:block">End</span>
          <span />
        </div>

        {/* Rows */}
        {items.map((item) => (
          <RecurringRow
            key={item.id}
            item={item}
            isFocused={state.focusedRowId === item.id}
            isSelected={state.selectedIds.has(item.id)}
            editingCol={state.editingCell?.rowId === item.id ? state.editingCell.col : null}
            hasSelection={hasSelection}
            orderedIds={orderedRowIds}
            categories={filteredCategories}
            dispatch={dispatch}
            onEditField={onEditField}
            onToggleActive={onToggleActive}
            onDelete={onDelete}
            onCreateCategory={handleCreateCategory}
            inactive={inactive}
          />
        ))}

        {/* Empty state */}
        {items.length === 0 && !inactive && (
          <div className="px-4 py-6 text-center text-text-muted text-sm">
            No recurring {type} rules
          </div>
        )}

        {/* Inline add */}
        {!inactive && (
          <RecurringInlineAddRow
            type={type}
            categories={categories}
            onAdd={onAdd}
            onCreateCategory={onCreateCategory}
          />
        )}
      </div>

      {/* Bulk action bar */}
      {hasSelection && !inactive && (
        <RecurringBulkActionBar
          selectedIds={state.selectedIds}
          categories={filteredCategories}
          onDelete={(ids) => { if (onBulkDelete) { onBulkDelete(ids); } else { for (const id of ids) onDelete(id); } }}
          onToggleActive={(ids) => { for (const id of ids) onToggleActive(id); }}
          onChangeCategory={(ids, catId) => { for (const id of ids) onEditField(id, { category_id: catId }); }}
          onClearSelection={() => dispatch({ type: "CLEAR_SELECTION" })}
        />
      )}
    </div>
  );
}
