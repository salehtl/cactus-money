# Overview Summary Tab Design

## Summary

Add a "Summary" tab (default) to the overview page with KPI cards and charts. The existing detailed pivot grid becomes a "Detailed" tab. Tab preference persisted in settings DB.

## Tab Structure

- Two tabs: **Summary** (default) | **Detailed**
- Active tab stored in `settings` table (key: `overview_tab`)
- Summary = KPI cards + charts. Detailed = existing chart + pivot grid (unchanged).

## KPI Cards (4 across, 2x2 on mobile)

1. **Savings Rate** — `(income - expenses) / income * 100` %. Trend: first half vs second half of range.
2. **Avg Monthly Spend** — total expenses / month count. Trend: vs equivalent prior period.
3. **Top Category** — highest spend category name + amount + color dot + % of total.
4. **Net Cash Flow** — income minus expenses, green/red. Trend: vs prior period.

## Trend Calculation

Compare selected range against equivalent prior period (e.g. Jan-Jun vs prior Jul-Dec). Additional `getTransactionsForRange` call for prior data. Show `↑ 12%` / `↓ 5%` with color. No indicator if no prior data.

## Charts (side-by-side desktop, stacked mobile)

1. **Income vs Expense bars + net line** — existing ComposedChart, relocated
2. **Expense Breakdown donut** — Recharts PieChart by parent category, top 6 + "Other", uses category colors

## Layout

```
[Tab Bar: Summary | Detailed]
[Month Range Picker]

Summary:
  4 KPI cards (4-col desktop, 2x2 mobile)
  2 charts (2-col desktop, stacked mobile)

Detailed:
  Existing OverviewSummary + CashflowChart + MultiMonthView (unchanged)
```

## Implementation Notes

- All data from existing `transactions` array + one extra fetch for prior period
- Tab preference via `getSetting`/`setSetting` with `overview_tab` key
- Donut chart uses Recharts PieChart (already a project dependency)
- No new DB queries beyond the prior-period comparison fetch
