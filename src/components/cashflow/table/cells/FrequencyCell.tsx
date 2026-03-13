import { useRef, useCallback } from "react";
import { FREQUENCIES } from "../types.ts";
import { useClickOutside, useEscapeKey } from "../../../../hooks/useClickOutside.ts";

interface FrequencyCellProps {
  value: string | null;
  isEditing: boolean;
  onStartEdit: () => void;
  onCommit: (value: string | null) => void;
  onCancel: () => void;
  required?: boolean;
  readOnly?: boolean;
}

export function FrequencyCell({
  value,
  isEditing,
  onStartEdit,
  onCommit,
  onCancel,
  required,
  readOnly,
}: FrequencyCellProps) {
  const shortLabel = value ? FREQUENCIES.find((f) => f.value === value)?.short ?? value : null;
  const popoverRef = useRef<HTMLDivElement>(null);

  useClickOutside(popoverRef, onCancel, isEditing);
  useEscapeKey(onCancel, isEditing);

  const handleSelect = useCallback((newValue: string | null) => {
    if (newValue !== value) {
      onCommit(newValue);
    } else {
      onCancel();
    }
  }, [value, onCommit, onCancel]);

  return (
    <div className="hidden sm:flex justify-center relative">
      <div
        className="cursor-default"
        onClick={(e) => { e.stopPropagation(); if (!readOnly) onStartEdit(); }}
      >
        {shortLabel ? (
          <span className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-semibold bg-accent/8 text-accent leading-tight">
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            {shortLabel}
          </span>
        ) : (
          <span className="text-[10px] text-border-dark">&mdash;</span>
        )}
      </div>

      {isEditing && (
        <div
          ref={popoverRef}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-[60] min-w-[120px] rounded-lg border border-border bg-surface shadow-lg py-1 animate-slide-up"
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {!required && (
            <button
              onClick={() => handleSelect(null)}
              className={`w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors ${
                !value ? "text-accent font-medium bg-accent/8" : "text-text-muted hover:bg-surface-alt"
              }`}
            >
              None
            </button>
          )}
          {FREQUENCIES.map((f) => (
            <button
              key={f.value}
              onClick={() => handleSelect(f.value)}
              className={`w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors ${
                value === f.value ? "text-accent font-medium bg-accent/8" : "text-text-muted hover:bg-surface-alt"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
