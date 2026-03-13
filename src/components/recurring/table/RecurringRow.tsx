import { memo } from "react";
import type { RecurringTransaction, Category } from "../../../types/database.ts";
import type { TableAction } from "../../cashflow/table/types.ts";
import { RECURRING_GRID_COLS, RECURRING_COLUMN_INDEX } from "./types.ts";
import { PayeeCell } from "../../cashflow/table/cells/PayeeCell.tsx";
import { AmountCell } from "../../cashflow/table/cells/AmountCell.tsx";
import { FrequencyCell } from "../../cashflow/table/cells/FrequencyCell.tsx";
import { CategoryCell } from "../../cashflow/table/cells/CategoryCell.tsx";
import { DateCell } from "../../cashflow/table/cells/DateCell.tsx";
import { EndDateCell } from "./EndDateCell.tsx";
import { RecurringActionsCell } from "./RecurringActionsCell.tsx";
import { formatCurrency } from "../../../lib/format.ts";
import { getToday } from "../../../lib/format.ts";

interface RecurringRowProps {
  item: RecurringTransaction;
  isFocused: boolean;
  isSelected: boolean;
  editingCol: number | null;
  hasSelection: boolean;
  orderedIds: string[];
  categories: Category[];
  dispatch: (action: TableAction) => void;
  onEditField: (id: string, updates: Record<string, unknown>) => void;
  onToggleActive: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateCategory?: (name: string) => Promise<string>;
  inactive?: boolean;
}

/** Determine why a rule is inactive */
function getInactiveReason(item: RecurringTransaction): "paused" | "ended" | null {
  if (item.is_active) return null;
  if (item.end_date && item.end_date < getToday()) return "ended";
  return "paused";
}

export const RecurringRow = memo(function RecurringRow({
  item,
  isFocused,
  isSelected,
  editingCol,
  hasSelection,
  orderedIds,
  categories,
  dispatch,
  onEditField,
  onToggleActive,
  onDelete,
  onCreateCategory,
  inactive,
}: RecurringRowProps) {
  const isIncome = item.type === "income";
  const cat = categories.find((c) => c.id === item.category_id);
  const isDue = item.is_active && item.next_occurrence <= getToday();
  const inactiveReason = inactive ? getInactiveReason(item) : null;

  function handleRowClick(e: React.MouseEvent) {
    if (inactive) return;
    if (e.shiftKey) {
      e.preventDefault();
      dispatch({ type: "RANGE_SELECT", rowId: item.id, orderedIds });
      return;
    }
    if (hasSelection) {
      dispatch({ type: "TOGGLE_SELECT", rowId: item.id });
      return;
    }
    dispatch({ type: "FOCUS_CELL", rowId: item.id, col: RECURRING_COLUMN_INDEX.payee });
  }

  function startEditCell(col: number) {
    if (inactive) return;
    dispatch({ type: "EDIT_CELL", rowId: item.id, col });
  }

  function commitCell(field: string, value: unknown) {
    dispatch({ type: "COMMIT_CELL" });
    onEditField(item.id, { [field]: value });
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
        className={`grid ${RECURRING_GRID_COLS} gap-x-3 items-center px-3 py-1.5 sm:py-0 sm:h-9 hover:bg-surface-alt/50 transition-colors cursor-default ${inactive ? "opacity-60" : ""}`}
      >
        {/* Checkbox */}
        <div className="flex items-center justify-center" onClick={(e) => {
          if (inactive) return;
          e.stopPropagation();
          if (e.shiftKey) {
            dispatch({ type: "RANGE_SELECT", rowId: item.id, orderedIds });
          } else {
            dispatch({ type: "TOGGLE_SELECT", rowId: item.id });
          }
        }}>
          {!inactive ? (
            <input
              type="checkbox"
              checked={isSelected}
              readOnly
              className="w-3.5 h-3.5 rounded border-border-dark accent-accent cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity data-[checked]:opacity-100 pointer-events-none"
              data-checked={isSelected || undefined}
              style={isSelected ? { opacity: 1 } : undefined}
            />
          ) : (
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${inactiveReason === "ended" ? "bg-text-light/40" : "bg-warning/60"}`} title={inactiveReason === "ended" ? "Ended" : "Paused"} />
          )}
        </div>

        {/* Payee */}
        <div className="min-w-0">
          {inactive ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "var(--color-border-dark)" }} />
              <span className="text-[13px] truncate text-text-muted">{item.payee || "Untitled"}</span>
              <span className={`text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded ${inactiveReason === "ended" ? "bg-border/50 text-text-light" : "bg-warning/15 text-warning"}`}>
                {inactiveReason === "ended" ? "Ended" : "Paused"}
              </span>
            </div>
          ) : (
            <PayeeCell
              value={item.payee || "Untitled"}
              categoryColor={cat?.color ?? null}
              isPlanned={false}
              isEditing={editingCol === RECURRING_COLUMN_INDEX.payee}
              onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.payee)}
              onCommit={(v) => commitCell("payee", v)}
              onCancel={cancelCell}
              onAdvance={advanceCell}
            />
          )}
          {/* Mobile secondary info */}
          <span className="text-[10px] text-text-light truncate block sm:hidden leading-tight">
            {item.frequency} {cat ? `\u00b7 ${cat.name}` : ""}
          </span>
        </div>

        {/* Amount */}
        <div className="hidden sm:block">
          {inactive ? (
            <span className={`text-[13px] font-medium tabular-nums text-right block text-text-muted`}>
              {item.is_variable ? "~" : ""}{formatCurrency(item.amount)}
            </span>
          ) : (
            <div className="flex items-center justify-end gap-0.5">
              {!!item.is_variable && <span className="text-[10px] text-warning shrink-0">~</span>}
              <AmountCell
                value={item.amount}
                isPlanned={false}
                isEditing={editingCol === RECURRING_COLUMN_INDEX.amount}
                onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.amount)}
                onCommit={(v) => commitCell("amount", v)}
                onCancel={cancelCell}
                onAdvance={advanceCell}
              />
              {!!item.is_variable && (
                <span className="text-warning text-[10px] shrink-0" title="Variable amount">&#x26A1;</span>
              )}
            </div>
          )}
        </div>
        {/* Mobile amount */}
        <span className={`text-[13px] font-medium tabular-nums block sm:hidden ${isIncome ? "text-success" : ""}`}>
          {item.is_variable ? "~" : ""}{isIncome ? "+" : ""}{formatCurrency(item.amount)}
        </span>

        {/* Frequency */}
        {inactive ? (
          <div className="hidden sm:flex justify-center">
            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-semibold bg-surface-alt text-text-muted leading-tight">
              {item.frequency === "weekly" ? "Wk" : item.frequency === "biweekly" ? "2W" : item.frequency === "monthly" ? "Mo" : item.frequency === "quarterly" ? "Qt" : item.frequency === "yearly" ? "Yr" : item.frequency}
            </span>
          </div>
        ) : (
          <FrequencyCell
            value={item.frequency}
            isEditing={editingCol === RECURRING_COLUMN_INDEX.frequency}
            onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.frequency)}
            onCommit={(v) => commitCell("frequency", v)}
            onCancel={cancelCell}
            required
          />
        )}

        {/* Category */}
        {inactive ? (
          <div className="hidden sm:block">
            <span className="text-[11px] text-text-muted text-center truncate block">{cat?.name ?? "\u2014"}</span>
          </div>
        ) : (
          <CategoryCell
            value={item.category_id}
            displayName={cat?.name ?? null}
            categories={categories}
            isEditing={editingCol === RECURRING_COLUMN_INDEX.category}
            onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.category)}
            onCommit={(v) => commitCell("category_id", v)}
            onCancel={cancelCell}
            onCreateCategory={onCreateCategory}
          />
        )}

        {/* Start Date */}
        {inactive ? (
          <div className="hidden sm:block">
            <span className="text-[11px] text-text-light text-center block tabular-nums">
              {new Date(item.start_date + "T00:00:00").toLocaleDateString("en-AE", { month: "short", day: "numeric" })}
            </span>
          </div>
        ) : (
          <DateCell
            value={item.start_date}
            isEditing={editingCol === RECURRING_COLUMN_INDEX.start_date}
            onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.start_date)}
            onCommit={(v) => commitCell("start_date", v)}
            onCancel={cancelCell}
          />
        )}

        {/* End Date */}
        {inactive ? (
          <div className="hidden sm:block">
            <span className="text-[11px] text-text-light/50 text-center block">
              {item.end_date ? new Date(item.end_date + "T00:00:00").toLocaleDateString("en-AE", { month: "short", day: "numeric" }) : "Open"}
            </span>
          </div>
        ) : (
          <EndDateCell
            value={item.end_date}
            isEditing={editingCol === RECURRING_COLUMN_INDEX.end_date}
            onStartEdit={() => startEditCell(RECURRING_COLUMN_INDEX.end_date)}
            onCommit={(v) => commitCell("end_date", v)}
            onCancel={cancelCell}
          />
        )}

        {/* Actions — always available, even for inactive rows */}
        <RecurringActionsCell
          isActive={!!item.is_active}
          onToggleActive={() => onToggleActive(item.id)}
          onDelete={() => onDelete(item.id)}
        />
      </div>

      {/* Due indicator on mobile */}
      {isDue && (
        <div className="flex items-center gap-1 px-3 pb-1 sm:hidden">
          <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
          <span className="text-[10px] text-warning">Due</span>
        </div>
      )}
    </div>
  );
});
