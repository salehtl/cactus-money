import { useState, useRef, useCallback } from "react";
import type { CashflowRow } from "../../../../lib/cashflow.ts";
import { useClickOutside } from "../../../../hooks/useClickOutside.ts";

interface ActionsCellProps {
  row: CashflowRow;
  onDelete: () => void;
  onDuplicate?: () => void;
  onStopRecurrence?: () => void;
  onSwitchType?: () => void;
}

export function ActionsCell({
  row,
  onDelete,
  onDuplicate,
  onStopRecurrence,
  onSwitchType,
}: ActionsCellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useClickOutside(menuRef, closeMenu, menuOpen);

  return (
    <div className="relative flex items-center justify-end" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="p-1 rounded-md text-text-light hover:text-text-muted sm:opacity-0 sm:group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-[70] min-w-[160px] rounded-lg border border-border bg-surface shadow-lg py-1 animate-slide-up">
          {onDuplicate && (
            <button
              onClick={() => { onDuplicate(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-text-muted hover:bg-surface-alt hover:text-text transition-colors cursor-pointer"
            >
              Duplicate
            </button>
          )}
          {onSwitchType && (
            <button
              onClick={() => { onSwitchType(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-text-muted hover:bg-surface-alt hover:text-text transition-colors cursor-pointer"
            >
              Move to {row.type === "income" ? "expenses" : "income"}
            </button>
          )}
          {row.isRecurring && row.recurringId && onStopRecurrence && (
            <button
              onClick={() => { onStopRecurrence(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-text-muted hover:bg-surface-alt hover:text-text transition-colors cursor-pointer"
            >
              Stop recurrence
            </button>
          )}
          <button
            onClick={() => { onDelete(); setMenuOpen(false); }}
            className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-danger hover:bg-danger-light/30 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
