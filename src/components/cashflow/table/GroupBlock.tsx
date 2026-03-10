import { useState, memo } from "react";
import type { CashflowGroup, CashflowRow } from "../../../lib/cashflow.ts";
import type { Category } from "../../../types/database.ts";
import type { TableAction } from "./types.ts";
import { TransactionRow } from "./TransactionRow.tsx";
import { formatCurrency } from "../../../lib/format.ts";

interface GroupBlockProps {
  group: CashflowGroup;
  focusedRowId: string | null;
  editingCell: { rowId: string; col: number } | null;
  selectedIds: Set<string>;
  hasSelection: boolean;
  orderedIds: string[];
  categories: Category[];
  dispatch: (action: TableAction) => void;
  onEditRow: (id: string, updates: Record<string, unknown>) => void;
  onToggleStatus: (id: string, newStatus: "planned" | "confirmed" | "review") => void;
  onDeleteRow: (id: string) => void;
  onDuplicateRow?: (row: CashflowRow) => void;
  onStopRecurrence?: (recurringId: string) => void;
  onAttachRecurrence?: (txnId: string, row: CashflowRow, frequency: import("../../../types/database.ts").RecurringTransaction["frequency"]) => void;
  onUpdateRecurringFrequency?: (recurringId: string, frequency: import("../../../types/database.ts").RecurringTransaction["frequency"]) => void;
  onCreateCategory?: (name: string) => Promise<string>;
}

export const GroupBlock = memo(function GroupBlock({
  group,
  focusedRowId,
  editingCell,
  selectedIds,
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
  onUpdateRecurringFrequency,
  onCreateCategory,
}: GroupBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const hasGroupName = group.name !== "";

  const rows = hasGroupName && !expanded ? [] : group.rows;

  return (
    <div>
      {hasGroupName && (
        <div
          className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2 cursor-pointer hover:bg-surface-alt/80 transition-colors border-b border-border bg-surface-alt/40"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <svg
              className={`w-3 h-3 text-text-light transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-xs font-semibold text-text truncate">{group.name}</span>
            <span className="text-[10px] text-text-light tabular-nums shrink-0">
              {group.rows.length}
            </span>
          </div>
          <span className="text-xs font-semibold tabular-nums pr-1">
            {formatCurrency(group.total)}
          </span>
        </div>
      )}

      {rows.map((row) => {
        const editingCol = editingCell?.rowId === row.id ? editingCell.col : null;
        return (
          <TransactionRow
            key={row.id}
            row={row}
            isFocused={focusedRowId === row.id}
            isSelected={selectedIds.has(row.id)}
            editingCol={editingCol}
            hasSelection={hasSelection}
            orderedIds={orderedIds}
            categories={categories}
            dispatch={dispatch}
            onEditRow={onEditRow}
            onToggleStatus={onToggleStatus}
            onDeleteRow={onDeleteRow}
            onDuplicateRow={onDuplicateRow}
            onStopRecurrence={onStopRecurrence}
            onAttachRecurrence={onAttachRecurrence}
            onUpdateRecurringFrequency={onUpdateRecurringFrequency}
            onCreateCategory={onCreateCategory}
          />
        );
      })}
    </div>
  );
});
