import { memo, useMemo } from "react";
import type { CashflowRow } from "../../../lib/cashflow.ts";
import type { Category, RecurringTransaction } from "../../../types/database.ts";
import type { TableAction } from "./types.ts";
import { GRID_COLS, COLUMN_INDEX, FREQUENCIES } from "./types.ts";
import { PayeeCell } from "./cells/PayeeCell.tsx";
import { DateCell } from "./cells/DateCell.tsx";
import { CategoryCell } from "./cells/CategoryCell.tsx";
import { FrequencyCell } from "./cells/FrequencyCell.tsx";
import { AmountCell } from "./cells/AmountCell.tsx";
import { StatusCell } from "./cells/StatusCell.tsx";
import { ActionsCell } from "./cells/ActionsCell.tsx";
import { formatDateShort } from "../../../lib/format.ts";

interface TransactionRowProps {
  row: CashflowRow;
  isFocused: boolean;
  isSelected: boolean;
  editingCol: number | null;
  hasSelection: boolean;
  orderedIds: string[];
  categories: Category[];
  dispatch: (action: TableAction) => void;
  onEditRow: (id: string, updates: Record<string, unknown>) => void;
  onToggleStatus: (id: string, newStatus: "planned" | "confirmed" | "review") => void;
  onDeleteRow: (id: string) => void;
  onDuplicateRow?: (row: CashflowRow) => void;
  onStopRecurrence?: (recurringId: string) => void;
  onAttachRecurrence?: (txnId: string, row: CashflowRow, frequency: RecurringTransaction["frequency"]) => void;
  onCreateCategory?: (name: string) => Promise<string>;
}

export const TransactionRow = memo(function TransactionRow({
  row,
  isFocused,
  isSelected,
  editingCol,
  hasSelection,
  orderedIds,
  categories,
  dispatch,
  onEditRow,
  onToggleStatus,
  onDeleteRow,
  onDuplicateRow,
  onStopRecurrence,
  onAttachRecurrence,
  onCreateCategory,
}: TransactionRowProps) {
  const isPlanned = row.status === "planned" || row.status === "review";
  const nextStatus = row.status === "confirmed" ? "planned" : "confirmed";

  // Mobile secondary info
  const secondaryInfo = useMemo(() => [
    formatDateShort(row.date),
    row.categoryName,
    row.frequency ? FREQUENCIES.find((f) => f.value === row.frequency)?.short : null,
  ].filter(Boolean).join(" \u00b7 "), [row.date, row.categoryName, row.frequency]);

  function handleRowClick(e: React.MouseEvent) {
    if (e.shiftKey) {
      e.preventDefault();
      dispatch({ type: "RANGE_SELECT", rowId: row.id, orderedIds });
      return;
    }
    if (hasSelection) {
      dispatch({ type: "TOGGLE_SELECT", rowId: row.id });
      return;
    }
    dispatch({ type: "FOCUS_CELL", rowId: row.id, col: COLUMN_INDEX.payee });
  }

  function startEditCell(col: number) {
    dispatch({ type: "EDIT_CELL", rowId: row.id, col });
  }

  function commitCell(field: string, value: unknown) {
    dispatch({ type: "COMMIT_CELL" });
    onEditRow(row.id, { [field]: value });
  }

  function cancelCell() {
    dispatch({ type: "CANCEL_CELL" });
  }

  function advanceCell(direction: 1 | -1) {
    dispatch({ type: "ADVANCE_CELL", direction });
  }

  const focusBorder = isFocused ? "border-l-2 border-l-accent bg-accent/[0.03]" : "border-l-2 border-l-transparent";
  const selectedBg = isSelected ? "bg-accent/[0.06]" : "";

  return (
    <div className={`group border-b border-border/60 last:border-b-0 ${focusBorder} ${selectedBg}`}>
      <div
        onClick={handleRowClick}
        className={`grid ${GRID_COLS} gap-x-3 items-center px-3 py-1.5 sm:py-0 sm:h-9 hover:bg-surface-alt/50 transition-colors cursor-default`}
      >
        {/* Checkbox */}
        <div className="flex items-center justify-center" onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey) {
            dispatch({ type: "RANGE_SELECT", rowId: row.id, orderedIds });
          } else {
            dispatch({ type: "TOGGLE_SELECT", rowId: row.id });
          }
        }}>
          <input
            type="checkbox"
            checked={isSelected}
            readOnly
            className="w-3.5 h-3.5 rounded border-border-dark accent-accent cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity data-[checked]:opacity-100 pointer-events-none"
            data-checked={isSelected || undefined}
            style={isSelected ? { opacity: 1 } : undefined}
          />
        </div>

        {/* Payee */}
        <div className="min-w-0">
          <PayeeCell
            value={row.label}
            categoryColor={row.categoryColor}
            isPlanned={isPlanned}
            isEditing={editingCol === COLUMN_INDEX.payee}
            onStartEdit={() => startEditCell(COLUMN_INDEX.payee)}
            onCommit={(v) => commitCell("payee", v)}
            onCancel={cancelCell}
            onAdvance={advanceCell}
          />
          {/* Mobile secondary info */}
          <span className="text-[10px] text-text-light truncate block sm:hidden leading-tight">
            {secondaryInfo}
          </span>
        </div>

        {/* Date */}
        <DateCell
          value={row.date}
          isEditing={editingCol === COLUMN_INDEX.date}
          onStartEdit={() => startEditCell(COLUMN_INDEX.date)}
          onCommit={(v) => commitCell("date", v)}
          onCancel={cancelCell}
        />

        {/* Category */}
        <CategoryCell
          value={row.categoryId}
          displayName={row.categoryName}
          categories={categories}
          isEditing={editingCol === COLUMN_INDEX.category}
          onStartEdit={() => startEditCell(COLUMN_INDEX.category)}
          onCommit={(v) => commitCell("category_id", v)}
          onCancel={cancelCell}
          onCreateCategory={onCreateCategory}
        />

        {/* Frequency — read-only for existing recurring rules (edit from recurring page) */}
        <FrequencyCell
          value={row.frequency}
          isEditing={editingCol === COLUMN_INDEX.frequency}
          readOnly={!!row.recurringId}
          onStartEdit={() => startEditCell(COLUMN_INDEX.frequency)}
          onCommit={(v) => {
            dispatch({ type: "COMMIT_CELL" });
            // Only non-recurring transactions can attach a new rule from cashflow
            if (v !== null && !row.recurringId && onAttachRecurrence) {
              onAttachRecurrence(row.id, row, v as RecurringTransaction["frequency"]);
            }
          }}
          onCancel={cancelCell}
        />

        {/* Amount */}
        <AmountCell
          value={row.amount}
          isPlanned={isPlanned}
          isEditing={editingCol === COLUMN_INDEX.amount}
          onStartEdit={() => startEditCell(COLUMN_INDEX.amount)}
          onCommit={(v) => commitCell("amount", v)}
          onCancel={cancelCell}
          onAdvance={advanceCell}
        />

        {/* Status */}
        <StatusCell
          status={row.status}
          onToggle={() => onToggleStatus(row.id, nextStatus)}
        />

        {/* Actions */}
        <ActionsCell
          row={row}
          onDelete={() => onDeleteRow(row.id)}
          onDuplicate={onDuplicateRow ? () => onDuplicateRow(row) : undefined}
          onStopRecurrence={
            row.isRecurring && row.recurringId && onStopRecurrence
              ? () => onStopRecurrence(row.recurringId!)
              : undefined
          }
        />
      </div>
    </div>
  );
});
