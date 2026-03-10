import type { TransactionWithCategory } from "../db/queries/transactions.ts";

export type GroupBy = "category" | "group_name" | "type" | "none";

export interface CashflowRow {
  id: string;
  label: string;
  type: "income" | "expense";
  status: "planned" | "confirmed" | "review";
  isRecurring: boolean;
  recurringId: string | null;
  frequency: string | null;
  date: string;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  groupName: string;
}

export interface CashflowGroup {
  name: string;
  rows: CashflowRow[];
  total: number;
}

export interface CashflowSummary {
  income: number;
  expenses: number;
  net: number;
  plannedIncome: number;
  confirmedIncome: number;
  plannedExpenses: number;
  confirmedExpenses: number;
}

// --- Multi-month grid types (used by overview) ---

export interface CashflowCell {
  amount: number;
  isProjected: boolean;
}

export interface CashflowGridRow {
  id: string;
  label: string;
  type: "income" | "expense";
  groupName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  monthValues: Map<string, CashflowCell>;
}

export interface CashflowGridGroup {
  name: string;
  categoryId: string | null;
  rows: CashflowGridRow[];
  monthTotals: Map<string, number>;
}

export interface CashflowGrid {
  months: string[];
  incomeGroups: CashflowGridGroup[];
  expenseGroups: CashflowGridGroup[];
  monthTotals: Map<string, { income: number; expense: number; net: number }>;
}

// --- Helpers ---

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// --- Build rows from transactions ---

export function buildCashflowRows(
  transactions: TransactionWithCategory[],
  groupBy: GroupBy = "none"
): { incomeGroups: CashflowGroup[]; expenseGroups: CashflowGroup[]; summary: CashflowSummary } {
  const rows: CashflowRow[] = transactions.map((t) => ({
    id: t.id,
    label: t.payee || t.category_name || "Uncategorized",
    type: t.type,
    status: t.status,
    isRecurring: !!t.recurring_id,
    recurringId: t.recurring_id,
    frequency: t.recurring_frequency ?? null,
    date: t.date,
    amount: t.amount,
    categoryId: t.category_id,
    categoryName: t.category_name,
    categoryColor: t.category_color,
    groupName: t.group_name,
  }));

  // Compute summary
  const summary: CashflowSummary = {
    income: 0,
    expenses: 0,
    net: 0,
    plannedIncome: 0,
    confirmedIncome: 0,
    plannedExpenses: 0,
    confirmedExpenses: 0,
  };

  for (const row of rows) {
    if (row.type === "income") {
      summary.income += row.amount;
      if (row.status === "planned") summary.plannedIncome += row.amount;
      else summary.confirmedIncome += row.amount;
    } else {
      summary.expenses += row.amount;
      if (row.status === "planned") summary.plannedExpenses += row.amount;
      else summary.confirmedExpenses += row.amount;
    }
  }
  summary.net = summary.income - summary.expenses;

  // Group rows
  const incomeRows = rows.filter((r) => r.type === "income");
  const expenseRows = rows.filter((r) => r.type === "expense");

  const incomeGroups = groupRows(incomeRows, groupBy);
  const expenseGroups = groupRows(expenseRows, groupBy);

  return { incomeGroups, expenseGroups, summary };
}

function getGroupKey(row: CashflowRow, groupBy: GroupBy): string {
  switch (groupBy) {
    case "category":
      return row.categoryName || "Uncategorized";
    case "group_name":
      return row.groupName || "Ungrouped";
    case "type":
      return row.type === "income" ? "Income" : "Expenses";
    case "none":
      return "";
  }
}

function groupRows(rows: CashflowRow[], groupBy: GroupBy): CashflowGroup[] {
  if (groupBy === "none") {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return rows.length > 0 ? [{ name: "", rows, total }] : [];
  }

  const groupMap = new Map<string, CashflowGroup>();

  for (const row of rows) {
    const key = getGroupKey(row, groupBy);
    let group = groupMap.get(key);
    if (!group) {
      group = { name: key, rows: [], total: 0 };
      groupMap.set(key, group);
    }
    group.rows.push(row);
    group.total += row.amount;
  }

  return Array.from(groupMap.values()).sort((a, b) => b.total - a.total);
}
