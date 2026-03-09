import { useState } from "react";
import { formatCurrency } from "../../lib/format.ts";
import { getCurrentMonth } from "../../lib/cashflow.ts";
import type { CashflowGrid } from "../../lib/cashflow.ts";

interface MultiMonthViewProps {
  grid: CashflowGrid;
}

function formatMonthHeader(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(y, m - 1).toLocaleDateString("en-AE", { month: "short", year: "2-digit" });
}

export function MultiMonthView({ grid }: MultiMonthViewProps) {
  const currentMonth = getCurrentMonth();

  // Running balance
  const runningBalances = new Map<string, number>();
  let balance = 0;
  for (const month of grid.months) {
    const totals = grid.monthTotals.get(month);
    balance += totals?.net ?? 0;
    runningBalances.set(month, balance);
  }

  return (
    <div className="overflow-x-auto border border-border rounded-xl bg-surface">
      <div
        className="min-w-max"
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(140px, 1.2fr) repeat(${grid.months.length}, minmax(88px, 1fr))`,
        }}
      >
        {/* Header */}
        <div className="sticky left-0 z-20 bg-surface-alt px-3 py-2 text-xs font-medium text-text-muted border-b border-border">
          Item
        </div>
        {grid.months.map((month) => (
          <div
            key={month}
            className={`px-3 py-2 text-xs font-medium text-text-muted text-right border-b border-border ${
              month === currentMonth
                ? "bg-accent/5 border-b-2 border-b-accent"
                : "bg-surface-alt"
            }`}
          >
            {formatMonthHeader(month)}
            {month === currentMonth && (
              <span className="ml-1 text-[9px] text-accent font-bold align-top">NOW</span>
            )}
          </div>
        ))}

        {/* Income section */}
        <SectionHeader label="Income" months={grid.months} variant="income" currentMonth={currentMonth} />
        {grid.incomeGroups.map((group) => (
          <GroupBlock key={group.name} group={group} months={grid.months} currentMonth={currentMonth} />
        ))}

        {/* Income total */}
        <TotalRow
          label="Total Income"
          months={grid.months}
          getAmount={(m) => grid.monthTotals.get(m)?.income ?? 0}
          variant="income"
          currentMonth={currentMonth}
        />

        {/* Expense section */}
        <SectionHeader label="Expenses" months={grid.months} variant="expense" currentMonth={currentMonth} />
        {grid.expenseGroups.map((group) => (
          <GroupBlock key={group.name} group={group} months={grid.months} currentMonth={currentMonth} />
        ))}

        {/* Expense total */}
        <TotalRow
          label="Total Expenses"
          months={grid.months}
          getAmount={(m) => grid.monthTotals.get(m)?.expense ?? 0}
          variant="expense"
          currentMonth={currentMonth}
        />

        {/* Net row */}
        <TotalRow
          label="Net"
          months={grid.months}
          getAmount={(m) => grid.monthTotals.get(m)?.net ?? 0}
          variant="net"
          currentMonth={currentMonth}
        />

        {/* Running balance row */}
        <div className="sticky left-0 z-20 bg-surface-alt px-3 py-2 text-xs font-bold border-t-2 border-accent/30 text-accent">
          Running Balance
        </div>
        {grid.months.map((month) => {
          const bal = runningBalances.get(month) ?? 0;
          return (
            <div
              key={month}
              className={`px-3 py-2 text-xs font-bold text-right border-t-2 border-accent/30 tabular-nums ${
                bal >= 0 ? "text-success" : "text-danger"
              } ${month === currentMonth ? "bg-accent/5" : "bg-surface"}`}
            >
              {formatCurrency(bal)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  months,
  variant,
}: {
  label: string;
  months: string[];
  variant: "income" | "expense";
  currentMonth: string;
}) {
  return (
    <>
      <div
        className={`sticky left-0 z-20 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border-b border-border ${
          variant === "income" ? "text-success bg-success-light/40" : "text-danger bg-danger-light/40"
        }`}
      >
        {label}
      </div>
      {months.map((month) => (
        <div
          key={month}
          className={`border-b border-border ${
            variant === "income" ? "bg-success-light/40" : "bg-danger-light/40"
          }`}
        />
      ))}
    </>
  );
}

function GroupBlock({
  group,
  months,
  currentMonth,
}: {
  group: CashflowGroup;
  months: string[];
  currentMonth: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      {/* Group header */}
      <div
        className="sticky left-0 z-20 bg-surface px-3 py-1.5 text-xs font-semibold text-text border-b border-border cursor-pointer flex items-center gap-1.5 hover:bg-surface-alt"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`w-3 h-3 text-text-light transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {group.name}
      </div>
      {months.map((month) => (
        <div
          key={month}
          className={`px-3 py-1.5 text-xs font-medium text-right border-b border-border tabular-nums ${
            month === currentMonth ? "bg-accent/5" : ""
          }`}
        >
          {group.monthTotals.get(month)
            ? formatCurrency(group.monthTotals.get(month)!)
            : <span className="text-text-light">&mdash;</span>}
        </div>
      ))}

      {/* Individual rows */}
      {expanded &&
        group.rows.map((row) => (
          <RowCells key={row.id} row={row} months={months} currentMonth={currentMonth} />
        ))}
    </>
  );
}

function RowCells({
  row,
  months,
  currentMonth,
}: {
  row: CashflowRow;
  months: string[];
  currentMonth: string;
}) {
  return (
    <>
      <div className="sticky left-0 z-20 bg-surface pl-8 pr-3 py-1 text-xs text-text-muted border-b border-border/50 flex items-center gap-1.5">
        <span className="truncate min-w-0">{row.label}</span>
      </div>
      {months.map((month) => {
        const cell = row.monthValues.get(month);
        return (
          <div
            key={month}
            className={`px-3 py-1 text-xs text-right border-b border-border/50 tabular-nums ${
              month === currentMonth ? "bg-accent/5" : ""
            } ${
              cell?.isProjected
                ? "text-text-light italic border-l-2 border-l-accent/20"
                : "text-text"
            }`}
          >
            {cell ? formatCurrency(cell.amount) : <span className="text-border-dark">&mdash;</span>}
          </div>
        );
      })}
    </>
  );
}

function TotalRow({
  label,
  months,
  getAmount,
  variant,
  currentMonth,
}: {
  label: string;
  months: string[];
  getAmount: (month: string) => number;
  variant: "income" | "expense" | "net";
  currentMonth: string;
}) {
  const colorClass =
    variant === "income"
      ? "text-success"
      : variant === "expense"
        ? "text-danger"
        : "";

  return (
    <>
      <div className={`sticky left-0 z-20 bg-surface-alt px-3 py-2 text-xs font-bold border-b border-border ${colorClass}`}>
        {label}
      </div>
      {months.map((month) => {
        const amount = getAmount(month);
        const netColor =
          variant === "net"
            ? amount >= 0
              ? "text-success"
              : "text-danger"
            : colorClass;
        return (
          <div
            key={month}
            className={`px-3 py-2 text-xs font-bold text-right border-b border-border bg-surface-alt tabular-nums ${netColor} ${
              month === currentMonth ? "!bg-accent/5" : ""
            }`}
          >
            {formatCurrency(amount)}
          </div>
        );
      })}
    </>
  );
}
