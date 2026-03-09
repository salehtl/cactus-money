import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  Bar, Line, XAxis, YAxis, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { MonthRangePicker } from "../components/ui/MonthRangePicker.tsx";
import { CashflowChart } from "../components/cashflow/CashflowChart.tsx";
import { MultiMonthView } from "../components/cashflow/MultiMonthView.tsx";
import { useDb } from "../context/DbContext.tsx";
import { getTransactionsForRange } from "../db/queries/cashflow.ts";
import { getCategories } from "../db/queries/categories.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { onDbEvent } from "../lib/db-events.ts";
import { formatCurrency } from "../lib/format.ts";
import type { TransactionWithCategory } from "../db/queries/transactions.ts";
import type { Category } from "../types/database.ts";

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});

type TabId = "summary" | "detailed";

function getDefaultStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01`;
}

function getDefaultEnd(): string {
  const now = new Date();
  return `${now.getFullYear()}-12`;
}

/** Compute the prior period of equal length ending just before startMonth */
function getPriorPeriod(startMonth: string, endMonth: string): { start: string; end: string } {
  const [sy, sm] = startMonth.split("-").map(Number) as [number, number];
  const [ey, em] = endMonth.split("-").map(Number) as [number, number];
  const months = (ey - sy) * 12 + (em - sm) + 1;

  // Go back `months` months from startMonth
  let py = sy;
  let pm = sm - months;
  while (pm < 1) { pm += 12; py--; }
  const priorStart = `${py}-${String(pm).padStart(2, "0")}`;

  // End is the month before startMonth
  let pey = sy;
  let pem = sm - 1;
  if (pem < 1) { pem = 12; pey--; }
  const priorEnd = `${pey}-${String(pem).padStart(2, "0")}`;

  return { start: priorStart, end: priorEnd };
}

function OverviewPage() {
  const db = useDb();
  const [tab, setTab] = useState<TabId>("summary");
  const [tabLoaded, setTabLoaded] = useState(false);
  const [startMonth, setStartMonth] = useState(getDefaultStart);
  const [endMonth, setEndMonth] = useState(getDefaultEnd);
  const [transactions, setTransactions] = useState<TransactionWithCategory[]>([]);
  const [priorTransactions, setPriorTransactions] = useState<TransactionWithCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Load persisted tab preference
  useEffect(() => {
    getSetting(db, "overview_tab").then((v) => {
      if (v === "summary" || v === "detailed") setTab(v);
      setTabLoaded(true);
    });
  }, [db]);

  function handleTabChange(newTab: TabId) {
    setTab(newTab);
    setSetting(db, "overview_tab", newTab);
  }

  const refresh = useCallback(async () => {
    const prior = getPriorPeriod(startMonth, endMonth);
    const [txns, priorTxns] = await Promise.all([
      getTransactionsForRange(db, startMonth, endMonth),
      getTransactionsForRange(db, prior.start, prior.end),
    ]);
    setTransactions(txns);
    setPriorTransactions(priorTxns);
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

  const monthData = buildMonthData(transactions, startMonth, endMonth);

  return (
    <div>
      <PageHeader title="Overview" />

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <MonthRangePicker
          startMonth={startMonth}
          endMonth={endMonth}
          onStartChange={setStartMonth}
          onEndChange={setEndMonth}
        />
        {tabLoaded && (
          <div className="flex rounded-lg border border-border bg-surface overflow-hidden">
            <TabButton active={tab === "summary"} onClick={() => handleTabChange("summary")}>Summary</TabButton>
            <TabButton active={tab === "detailed"} onClick={() => handleTabChange("detailed")}>Detailed</TabButton>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      ) : tab === "summary" ? (
        <SummaryView
          transactions={transactions}
          priorTransactions={priorTransactions}
          monthData={monthData}
        />
      ) : (
        <DetailedView transactions={transactions} monthData={monthData} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
        active ? "bg-accent text-white" : "text-text-muted hover:bg-surface-alt"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Summary View ────────────────────────────────────────────────────────────

interface SummaryViewProps {
  transactions: TransactionWithCategory[];
  priorTransactions: TransactionWithCategory[];
  monthData: ReturnType<typeof buildMonthData>;
}

function SummaryView({ transactions, priorTransactions, monthData }: SummaryViewProps) {
  const db = useDb();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getCategories(db).then(setCategories);
    return onDbEvent("categories-changed", () => getCategories(db).then(setCategories));
  }, [db]);

  const kpis = useMemo(() => computeKpis(transactions, priorTransactions, monthData.months.length), [transactions, priorTransactions, monthData.months.length]);
  const categoryBreakdown = useMemo(() => buildCategoryBreakdown(transactions, categories), [transactions, categories]);
  const chartData = useMemo(() => buildChartData(monthData), [monthData]);

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="Savings Rate"
          value={kpis.savingsRate !== null ? `${kpis.savingsRate.toFixed(1)}%` : "—"}
          trend={kpis.savingsRateTrend}
          valueColor={kpis.savingsRate !== null ? (kpis.savingsRate >= 0 ? "text-success" : "text-danger") : "text-text-muted"}
        />
        <KpiCard
          label="Avg Monthly Spend"
          value={formatCurrency(kpis.avgMonthlySpend)}
          trend={kpis.avgSpendTrend}
          invertTrend
        />
        <KpiCard
          label="Top Category"
          value={kpis.topCategory ? formatCurrency(kpis.topCategory.amount) : "—"}
          subtitle={kpis.topCategory ? `${kpis.topCategory.name} · ${kpis.topCategory.pct.toFixed(0)}%` : undefined}
          dotColor={kpis.topCategory?.color ?? undefined}
        />
        <KpiCard
          label="Net Cash Flow"
          value={formatCurrency(kpis.net)}
          trend={kpis.netTrend}
          valueColor={kpis.net >= 0 ? "text-success" : "text-danger"}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Income vs Expense bar chart */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Cashflow Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-light)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
                formatter={(value: number, name: string) => [
                  formatCurrency(value),
                  name === "balance" ? "Running Balance" : name.charAt(0).toUpperCase() + name.slice(1),
                ]}
              />
              <ReferenceLine y={0} stroke="var(--color-border-dark)" strokeDasharray="3 3" />
              <Bar dataKey="income" fill="var(--color-success)" radius={[3, 3, 0, 0]} barSize={20} opacity={0.85} />
              <Bar dataKey="expense" fill="var(--color-danger)" radius={[3, 3, 0, 0]} barSize={20} opacity={0.85} />
              <Line type="monotone" dataKey="balance" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--color-accent)", strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-2">
            <ChartLegend color="var(--color-success)" label="Income" />
            <ChartLegend color="var(--color-danger)" label="Expenses" />
            <ChartLegend color="var(--color-accent)" label="Balance" isLine />
          </div>
        </div>

        {/* Expense breakdown donut */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Expense Breakdown</h3>
          {categoryBreakdown.length === 0 ? (
            <div className="flex items-center justify-center h-[220px]">
              <p className="text-sm text-text-light">No expenses</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categoryBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {categoryBreakdown.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    formatter={(value: number) => [formatCurrency(value)]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-1">
                {categoryBreakdown.map((entry) => (
                  <ChartLegend key={entry.name} color={entry.color} label={entry.name} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: { pct: number } | null;
  invertTrend?: boolean;
  valueColor?: string;
  dotColor?: string;
}

function KpiCard({ label, value, subtitle, trend, invertTrend, valueColor, dotColor }: KpiCardProps) {
  const showTrend = trend && trend.pct !== 0;
  const trendUp = trend && trend.pct > 0;
  const trendColor = showTrend
    ? (invertTrend ? (trendUp ? "text-danger" : "text-success") : (trendUp ? "text-success" : "text-danger"))
    : undefined;

  return (
    <div className="bg-surface rounded-xl border border-border p-3 sm:p-4">
      <div className="flex items-center gap-1.5">
        {dotColor && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
        <p className="text-[11px] sm:text-xs text-text-muted font-medium truncate">{label}</p>
      </div>
      <p className={`text-base sm:text-lg font-bold mt-1 tabular-nums ${valueColor ?? ""}`}>{value}</p>
      <div className="flex items-center gap-1.5 mt-0.5 min-h-[18px]">
        {subtitle && (
          <span className="text-[10px] sm:text-[11px] text-text-light truncate">{subtitle}</span>
        )}
        {showTrend && (
          <span className={`text-[10px] sm:text-[11px] font-medium ${trendColor} flex items-center gap-0.5`}>
            {trendUp ? "↑" : "↓"} {Math.abs(trend.pct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Chart Legend ────────────────────────────────────────────────────────────

function ChartLegend({ color, label, isLine }: { color: string; label: string; isLine?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
      {isLine ? (
        <div className="w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
      ) : (
        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color, opacity: 0.85 }} />
      )}
      {label}
    </div>
  );
}

// ─── Detailed View ───────────────────────────────────────────────────────────

function DetailedView({ transactions, monthData }: { transactions: TransactionWithCategory[]; monthData: ReturnType<typeof buildMonthData> }) {
  return (
    <>
      <OverviewSummary transactions={transactions} />
      {monthData.months.length > 0 && <CashflowChart grid={monthData} />}
      {monthData.months.length > 0 && <MultiMonthView grid={monthData} />}
    </>
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

// ─── Data helpers ────────────────────────────────────────────────────────────

function computeKpis(
  transactions: TransactionWithCategory[],
  priorTransactions: TransactionWithCategory[],
  monthCount: number
) {
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (t.type === "income") income += t.amount;
    else expenses += t.amount;
  }
  const net = income - expenses;
  const savingsRate = income > 0 ? (net / income) * 100 : null;
  const avgMonthlySpend = monthCount > 0 ? expenses / monthCount : 0;

  // Top category by spend
  const catMap = new Map<string, { name: string; color: string; amount: number }>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = t.category_id ?? "__none__";
    const existing = catMap.get(key);
    if (existing) {
      existing.amount += t.amount;
    } else {
      catMap.set(key, { name: t.category_name ?? "Uncategorized", color: t.category_color ?? "#64748b", amount: t.amount });
    }
  }
  let topCategory: { name: string; color: string; amount: number; pct: number } | null = null;
  for (const cat of catMap.values()) {
    if (!topCategory || cat.amount > topCategory.amount) {
      topCategory = { ...cat, pct: expenses > 0 ? (cat.amount / expenses) * 100 : 0 };
    }
  }

  // Prior period comparison
  let priorIncome = 0, priorExpenses = 0;
  for (const t of priorTransactions) {
    if (t.type === "income") priorIncome += t.amount;
    else priorExpenses += t.amount;
  }
  const priorNet = priorIncome - priorExpenses;
  const priorSavingsRate = priorIncome > 0 ? (priorNet / priorIncome) * 100 : null;

  const hasPrior = priorTransactions.length > 0;

  function pctChange(current: number, prior: number): { pct: number } | null {
    if (!hasPrior || prior === 0) return null;
    return { pct: ((current - prior) / Math.abs(prior)) * 100 };
  }

  return {
    savingsRate,
    savingsRateTrend: savingsRate !== null && priorSavingsRate !== null
      ? pctChange(savingsRate, priorSavingsRate)
      : null,
    avgMonthlySpend,
    avgSpendTrend: pctChange(avgMonthlySpend, hasPrior && monthCount > 0 ? priorExpenses / monthCount : 0),
    topCategory,
    net,
    netTrend: pctChange(net, priorNet),
  };
}

function buildCategoryBreakdown(transactions: TransactionWithCategory[], categories: Category[]) {
  // Build lookup maps for parent resolution
  const catById = new Map<string, Category>();
  for (const c of categories) catById.set(c.id, c);

  const catMap = new Map<string, { name: string; color: string; value: number }>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    // Group by parent category ID for cleaner grouping
    let groupId = t.category_id ?? "__none__";
    let groupName = t.category_name ?? "Uncategorized";
    let groupColor = t.category_color ?? "#64748b";
    if (t.category_id) {
      const cat = catById.get(t.category_id);
      if (cat?.parent_id) {
        const parent = catById.get(cat.parent_id);
        if (parent) {
          groupId = parent.id;
          groupName = parent.name;
          groupColor = parent.color;
        }
      }
    }
    const existing = catMap.get(groupId);
    if (existing) {
      existing.value += t.amount;
    } else {
      catMap.set(groupId, { name: groupName, color: groupColor, value: t.amount });
    }
  }

  const sorted = Array.from(catMap.values()).sort((a, b) => b.value - a.value);

  // Top 6, rest as "Other"
  if (sorted.length <= 7) return sorted;

  const top = sorted.slice(0, 6);
  const otherTotal = sorted.slice(6).reduce((s, c) => s + c.value, 0);
  top.push({ name: "Other", color: "#94a3b8", value: otherTotal });
  return top;
}

function buildChartData(monthData: ReturnType<typeof buildMonthData>) {
  let runningBalance = 0;
  return monthData.months.map((month) => {
    const totals = monthData.monthTotals.get(month) ?? { income: 0, expense: 0, net: 0 };
    runningBalance += totals.net;
    const [y, m] = month.split("-").map(Number) as [number, number];
    return {
      month,
      label: new Date(y, m - 1).toLocaleDateString("en-AE", { month: "short" }),
      income: totals.income,
      expense: totals.expense,
      balance: runningBalance,
    };
  });
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
