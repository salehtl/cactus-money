import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { MonthRangePicker } from "../components/ui/MonthRangePicker.tsx";
import { CashflowChart } from "../components/cashflow/CashflowChart.tsx";
import { MultiMonthView } from "../components/cashflow/MultiMonthView.tsx";
import { useDb } from "../context/DbContext.tsx";
import { getTransactionsForRange } from "../db/queries/cashflow.ts";
import { onDbEvent } from "../lib/db-events.ts";
import { formatCurrency } from "../lib/format.ts";
import type { TransactionWithCategory } from "../db/queries/transactions.ts";

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});

function getDefaultStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01`;
}

function getDefaultEnd(): string {
  const now = new Date();
  return `${now.getFullYear()}-12`;
}

function OverviewPage() {
  const db = useDb();
  const [startMonth, setStartMonth] = useState(getDefaultStart);
  const [endMonth, setEndMonth] = useState(getDefaultEnd);
  const [transactions, setTransactions] = useState<TransactionWithCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const txns = await getTransactionsForRange(db, startMonth, endMonth);
    setTransactions(txns);
    setLoading(false);
  }, [db, startMonth, endMonth]);

  useEffect(() => {
    refresh();
    const unsubs = [
      onDbEvent("transactions-changed", refresh),
      onDbEvent("categories-changed", refresh),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [refresh]);

  // Build month-level summary data for chart and grid
  const monthData = buildMonthData(transactions, startMonth, endMonth);

  return (
    <div>
      <PageHeader title="Overview" />

      <div className="flex items-center gap-3 mb-4">
        <MonthRangePicker
          startMonth={startMonth}
          endMonth={endMonth}
          onStartChange={setStartMonth}
          onEndChange={setEndMonth}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <OverviewSummary transactions={transactions} />

          {/* Chart */}
          {monthData.months.length > 0 && (
            <CashflowChart grid={monthData} />
          )}

          {/* Multi-month pivot grid */}
          {monthData.months.length > 0 && (
            <MultiMonthView grid={monthData} />
          )}
        </>
      )}
    </div>
  );
}

function OverviewSummary({ transactions }: { transactions: TransactionWithCategory[] }) {
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of transactions) {
    if (t.type === "income") totalIncome += t.amount;
    else totalExpenses += t.amount;
  }

  const net = totalIncome - totalExpenses;

  return (
    <div className="flex items-stretch gap-3 overflow-x-auto mb-4">
      <div className="flex-1 min-w-[100px] bg-surface rounded-xl border border-border p-3 sm:p-4">
        <p className="text-[11px] sm:text-xs text-text-muted font-medium">Total Income</p>
        <p className="text-base sm:text-lg font-bold mt-1 text-success tabular-nums">{formatCurrency(totalIncome)}</p>
      </div>
      <div className="flex-1 min-w-[100px] bg-surface rounded-xl border border-border p-3 sm:p-4">
        <p className="text-[11px] sm:text-xs text-text-muted font-medium">Total Expenses</p>
        <p className="text-base sm:text-lg font-bold mt-1 text-danger tabular-nums">{formatCurrency(totalExpenses)}</p>
      </div>
      <div className="flex-1 min-w-[100px] bg-surface rounded-xl border border-border p-3 sm:p-4">
        <p className="text-[11px] sm:text-xs text-text-muted font-medium">Net</p>
        <p className={`text-base sm:text-lg font-bold mt-1 tabular-nums ${net >= 0 ? "text-success" : "text-danger"}`}>{formatCurrency(net)}</p>
      </div>
    </div>
  );
}

// Build the grid structure that CashflowChart and MultiMonthView expect
function buildMonthData(
  transactions: TransactionWithCategory[],
  startMonth: string,
  endMonth: string
) {
  // Generate month range
  const months: string[] = [];
  const [sy, sm] = startMonth.split("-").map(Number) as [number, number];
  const [ey, em] = endMonth.split("-").map(Number) as [number, number];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }

  // Group transactions by category+type, then by month
  interface RowData {
    label: string;
    type: "income" | "expense";
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    groupName: string;
    monthValues: Map<string, { amount: number; isProjected: boolean }>;
  }

  const rowsMap = new Map<string, RowData>();

  for (const t of transactions) {
    const txMonth = t.date.substring(0, 7);
    const key = `${t.type}:${t.category_id ?? "none"}:${t.group_name || t.payee}`;

    let row = rowsMap.get(key);
    if (!row) {
      row = {
        label: t.payee || t.category_name || "Uncategorized",
        type: t.type,
        categoryId: t.category_id,
        categoryName: t.category_name,
        categoryColor: t.category_color,
        groupName: t.group_name || t.category_name || "Other",
        monthValues: new Map(),
      };
      rowsMap.set(key, row);
    }

    const existing = row.monthValues.get(txMonth);
    if (existing) {
      existing.amount += t.amount;
    } else {
      row.monthValues.set(txMonth, { amount: t.amount, isProjected: t.status === "planned" });
    }
  }

  // Build groups
  type CashflowRow = {
    id: string;
    label: string;
    source: "actual";
    type: "income" | "expense";
    groupName: string;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    recurringId: null;
    monthValues: Map<string, { amount: number; isProjected: boolean }>;
    dbIds: string[];
  };

  type CashflowGroup = {
    name: string;
    categoryId: string | null;
    rows: CashflowRow[];
    monthTotals: Map<string, number>;
  };

  function buildGroups(rows: CashflowRow[]): CashflowGroup[] {
    const groupMap = new Map<string, CashflowGroup>();

    for (const row of rows) {
      const key = row.groupName;
      let group = groupMap.get(key);
      if (!group) {
        group = { name: key, categoryId: row.categoryId, rows: [], monthTotals: new Map() };
        groupMap.set(key, group);
      }
      group.rows.push(row);
      for (const [month, cell] of row.monthValues) {
        group.monthTotals.set(month, (group.monthTotals.get(month) ?? 0) + cell.amount);
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      const totalA = Array.from(a.monthTotals.values()).reduce((s, v) => s + v, 0);
      const totalB = Array.from(b.monthTotals.values()).reduce((s, v) => s + v, 0);
      return totalB - totalA;
    });
  }

  const allRows: CashflowRow[] = [];
  for (const [key, data] of rowsMap) {
    allRows.push({
      id: key,
      label: data.label,
      source: "actual",
      type: data.type,
      groupName: data.groupName,
      categoryId: data.categoryId,
      categoryName: data.categoryName,
      categoryColor: data.categoryColor,
      recurringId: null,
      monthValues: data.monthValues,
      dbIds: [],
    });
  }

  const incomeRows = allRows.filter((r) => r.type === "income");
  const expenseRows = allRows.filter((r) => r.type === "expense");

  const incomeGroups = buildGroups(incomeRows);
  const expenseGroups = buildGroups(expenseRows);

  // Month totals
  const monthTotals = new Map<string, { income: number; expense: number; net: number }>();
  for (const month of months) {
    let income = 0;
    let expense = 0;
    for (const row of allRows) {
      const cell = row.monthValues.get(month);
      if (cell) {
        if (row.type === "income") income += cell.amount;
        else expense += cell.amount;
      }
    }
    monthTotals.set(month, { income, expense, net: income - expense });
  }

  return { months, incomeGroups, expenseGroups, monthTotals };
}
