import { useState, useRef, useEffect } from "react";

interface MonthRangePickerProps {
  startMonth: string; // "YYYY-MM"
  endMonth: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  className?: string;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMonth(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map(Number) as [number, number];
  return { year: y, month: m };
}

function fmtMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatDisplay(value: string): string {
  const { year, month } = parseMonth(value);
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

function monthToNum(value: string): number {
  const { year, month } = parseMonth(value);
  return year * 12 + month;
}

type Preset = { label: string; start: string; end: string };

function getPresets(): Preset[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const q = Math.ceil(m / 3);
  const qStart = (q - 1) * 3 + 1;

  return [
    { label: "This Year", start: fmtMonth(y, 1), end: fmtMonth(y, 12) },
    { label: "YTD", start: fmtMonth(y, 1), end: fmtMonth(y, m) },
    { label: "This Quarter", start: fmtMonth(y, qStart), end: fmtMonth(y, qStart + 2) },
    { label: "Next 6 Mo", start: fmtMonth(y, m), end: fmtMonth(m + 6 > 12 ? y + 1 : y, ((m + 5) % 12) + 1) },
    { label: "Rolling 12", start: fmtMonth(y, m), end: fmtMonth(m === 12 ? y + 1 : m + 11 > 12 ? y + 1 : y, ((m + 10) % 12) + 1) },
  ];
}

export function MonthRangePicker({
  startMonth,
  endMonth,
  onStartChange,
  onEndChange,
  className = "",
}: MonthRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [viewYear, setViewYear] = useState(() => parseMonth(startMonth).year);
  const ref = useRef<HTMLDivElement>(null);
  const presets = getPresets();

  useEffect(() => {
    setViewYear(parseMonth(startMonth).year);
  }, [startMonth]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function selectMonth(month: number) {
    const value = fmtMonth(viewYear, month);
    if (picking === "start") {
      onStartChange(value);
      // If new start is after current end, bump end
      if (monthToNum(value) > monthToNum(endMonth)) {
        onEndChange(value);
      }
      setPicking("end");
    } else {
      // If new end is before current start, set start to this too
      if (monthToNum(value) < monthToNum(startMonth)) {
        onStartChange(value);
        onEndChange(value);
      } else {
        onEndChange(value);
      }
      setOpen(false);
      setPicking("start");
    }
  }

  function applyPreset(p: Preset) {
    onStartChange(p.start);
    onEndChange(p.end);
    setOpen(false);
    setPicking("start");
  }

  const startNum = monthToNum(startMonth);
  const endNum = monthToNum(endMonth);

  const activePreset = presets.find((p) => p.start === startMonth && p.end === endMonth);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setPicking("start"); }}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-alt transition-colors cursor-pointer outline-none focus:border-accent"
      >
        <svg className="w-3.5 h-3.5 text-text-light shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span>{formatDisplay(startMonth)}</span>
        <span className="text-text-light">&ndash;</span>
        <span>{formatDisplay(endMonth)}</span>
        <svg className={`w-3 h-3 text-text-light transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border border-border bg-surface shadow-lg animate-slide-up flex flex-col sm:flex-row w-[260px] sm:w-auto">
          {/* Presets — horizontal scroll on mobile, sidebar on desktop */}
          <div className="sm:border-r border-b sm:border-b-0 border-border p-2 sm:space-y-0.5 sm:w-[120px] shrink-0 flex sm:block gap-1 overflow-x-auto">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={`whitespace-nowrap sm:w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  activePreset?.label === p.label
                    ? "bg-accent/10 text-accent"
                    : "text-text-muted hover:text-text hover:bg-surface-alt"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar panel */}
          <div className="sm:w-[240px]">
            {/* Picking indicator */}
            <div className="flex border-b border-border text-[11px] font-medium">
              <button
                type="button"
                onClick={() => { setPicking("start"); setViewYear(parseMonth(startMonth).year); }}
                className={`flex-1 px-3 py-2 text-center cursor-pointer transition-colors ${
                  picking === "start"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-muted hover:text-text"
                }`}
              >
                Start: {formatDisplay(startMonth)}
              </button>
              <button
                type="button"
                onClick={() => { setPicking("end"); setViewYear(parseMonth(endMonth).year); }}
                className={`flex-1 px-3 py-2 text-center cursor-pointer transition-colors ${
                  picking === "end"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-muted hover:text-text"
                }`}
              >
                End: {formatDisplay(endMonth)}
              </button>
            </div>

            {/* Year nav */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <button
                type="button"
                onClick={() => setViewYear((y) => y - 1)}
                className="p-1 rounded hover:bg-surface-alt text-text-muted hover:text-text transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
              <button
                type="button"
                onClick={() => setViewYear((y) => y + 1)}
                className="p-1 rounded hover:bg-surface-alt text-text-muted hover:text-text transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-3 gap-1 p-2">
              {MONTH_LABELS.map((label, i) => {
                const m = i + 1;
                const cellVal = fmtMonth(viewYear, m);
                const cellNum = monthToNum(cellVal);
                const isStart = cellVal === startMonth;
                const isEnd = cellVal === endMonth;
                const isInRange = cellNum >= startNum && cellNum <= endNum;
                const now = new Date();
                const isCurrent = viewYear === now.getFullYear() && m === now.getMonth() + 1;

                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => selectMonth(m)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      isStart || isEnd
                        ? "bg-accent text-white"
                        : isInRange
                          ? "bg-accent/10 text-accent"
                          : isCurrent
                            ? "ring-1 ring-accent/30 text-accent hover:bg-accent/10"
                            : "text-text hover:bg-surface-alt"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
