# Recurring Transactions Engine Rewrite

**Date:** 2026-03-10
**Status:** Approved

## Problem Statement

The recurring transactions system has critical bugs and architectural limitations:

1. **Date drift bug** — `getNextOccurrence()` uses `toISOString()` which converts to UTC. In UTC+ timezones (UAE = UTC+4), local midnight becomes the previous day in UTC. Each iteration loses one day: a monthly rule starting Nov 24 drifts to Dec 23 → Jan 22 → Feb 21 → Mar 20.
2. **No anchor date** — Monthly recurring chains forward from the last computed date instead of always landing on a fixed day-of-month.
3. **Past transactions always "planned"** — `autoPopulateFutureTransactions` hardcodes `status='planned'` even for dates in the past.
4. **Dead code** — `processDue()` in `useRecurring` is never called.
5. **O(n) future month calculation** — `autoPopulateFutureTransactions` loops from `start_date` forward on every month load.
6. **No variable-amount support** — Utility bills and other fluctuating recurring expenses have no special handling.
7. **Layout issues** — Recurring page mixes income/expense in a flat list; doesn't match cashflow page grouping.
8. **Category creation bug** — `handleCreateCategory` on recurring page hardcodes `is_income: false`, so inline category creation from income rules creates expense categories.

## Design

### Schema Changes (v3 → v4)

**`recurring_transactions` table — new columns:**

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `anchor_day` | INTEGER | NULL | For monthly/quarterly/yearly: fixed day-of-month (1-31). Clamped to month-end (e.g., 31 in Feb → 28). NULL for weekly/daily/custom. |
| `is_variable` | INTEGER | 0 | Flags variable-amount recurring (utility bills). Amount field holds the default/last-known value. |

**`transactions` table — status expansion:**

```sql
-- Current: status IN ('planned', 'confirmed')
-- New:     status IN ('planned', 'confirmed', 'review')
```

The `'review'` status is for variable-amount recurring transactions that need the user to verify/update the amount.

**Migration strategy:**
- `ALTER TABLE recurring_transactions ADD COLUMN anchor_day INTEGER`
- `ALTER TABLE recurring_transactions ADD COLUMN is_variable INTEGER NOT NULL DEFAULT 0`
- Backfill: for existing monthly/quarterly/yearly rules, set `anchor_day = CAST(substr(start_date, 9, 2) AS INTEGER)`
- Auto-export JSON backup before applying migration (via File System Access if configured)
- Bump export format version from 2 → 3; import of v2 backups auto-derives `anchor_day` from `start_date`

### Core Engine: `getNextOccurrence()` Rewrite

**Fix 1 — UTC bug:**
Replace `d.toISOString().split("T")[0]` with manual formatting using local date getters:
```typescript
const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
const dd = String(d.getDate()).padStart(2, "0");
return `${yyyy}-${mm}-${dd}`;
```

**Fix 2 — Anchor day for monthly/quarterly/yearly:**
New signature: `getNextOccurrence(current, frequency, anchorDay?, customDays?)`

For monthly: advance month by 1, then clamp day to `min(anchorDay, daysInMonth)`.
For quarterly: advance month by 3, same clamping.
For yearly: advance year by 1, same clamping.

This ensures a rule anchored to the 31st always lands on the 31st (or 30th/28th/29th in shorter months).

### Recurring Scheduler: `processRecurringRules()`

Replaces both `processDue()` and `autoPopulateFutureTransactions()`. Single unified function.

**Runs once on app init (DbProvider mount):**

```
processRecurringRules(db, today):
  1. Get all active recurring rules
  2. For each rule where next_occurrence <= today:
     a. Determine status:
        - If is_variable: status = 'review'
        - Else: status = 'confirmed'
     b. Check if transaction already exists for this rule + date (idempotency)
     c. If not: create transaction with determined status
     d. Advance next_occurrence using getNextOccurrence(current, frequency, anchor_day, customDays)
     e. Repeat until next_occurrence > today (catches up all missed months)
     f. If next_occurrence > end_date: deactivate rule
  3. For each rule where next_occurrence is in current month but > today:
     a. Generate 'planned' transaction (future within current month)
  4. Emit "transactions-changed" + "recurring-changed" once at end
```

**Idempotency:** Before inserting, check `SELECT COUNT(*) FROM transactions WHERE recurring_id = ? AND date = ?`. This prevents duplicates on repeated runs.

### Future Month Population (Simplified)

When navigating to a future month:
- For each active rule: compute whether it has an occurrence in that month
- For monthly rules: occurrence = `YYYY-MM-{anchor_day}` (clamped)
- For weekly/biweekly: step forward from `next_occurrence` until in target month or past it
- O(1) for month-based frequencies, O(small) for week-based
- Insert 'planned' transaction if none exists for that rule + month

### Variable-Amount Recurring

**New `is_variable` flag on recurring rules:**
- When true, the scheduler generates transactions with `status = 'review'` instead of `'confirmed'`
- The `amount` on the rule is treated as the default (carried from last period)
- After the user edits and saves a `'review'` transaction, status auto-transitions to `'confirmed'`
- The recurring rule's `amount` is updated to match the confirmed amount (becomes the new default)

**Banner notification:**
- Amber banner on cashflow page when `review`-status transactions exist in the viewed month
- Content: `"{N} recurring items need updated amounts"` with a "Review" action
- Clicking "Review" scrolls to the first review-status row

### StatusPill Update

Three variants:
- **Confirmed** — green (existing)
- **Planned** — pink (existing)
- **Review** — orange/amber (new) — indicates variable-amount needing attention

Clicking the pill cycles: review → confirmed, planned → confirmed, confirmed → planned.

### Recurring Page UI Redesign

**Layout: mirrors cashflow page with Income/Expense groups.**

```
┌─────────────────────────────────────────────┐
│  Summary Bar                                │
│  [Recurring Income: X] [Expenses: Y] [Net]  │
├─────────────────────────────────────────────┤
│                                             │
│  INCOME                         total: X    │
│  ┌─────────────────────────────────────────┐│
│  │ Payee|Amount|Freq|Category|Start|End|Act││
│  │ Salary +5000  Mo  Employ.  Nov24 Open ⋮ ││
│  │ + Add income rule                       ││
│  └─────────────────────────────────────────┘│
│                                             │
│  EXPENSES                       total: Y    │
│  ┌─────────────────────────────────────────┐│
│  │ Payee|Amount|Freq|Category|Start|End|Act││
│  │ Rent   4000   Mo  Housing  Nov24 Open ⋮ ││
│  │ DEWA   ~350   Mo  Utils    Jan25 Open ⚡││
│  │ Netflix 55    Mo  Entert.  Mar24 Open ⋮ ││
│  │ + Add expense rule                      ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ▸ Inactive (3)                             │
└─────────────────────────────────────────────┘
```

**Key details:**
- 7-column grid retained: Payee | Amount | Frequency | Category | Start | End | Actions
- Inline add row at bottom of each group (Income / Expense)
- `handleCreateCategory` derives `is_income` from which group the form is in
- Variable-amount rules show `~` prefix on amount + lightning indicator
- Due rules show pulsing dot (existing behavior, kept)
- Inactive rules in collapsible section at bottom (existing behavior, kept)

### Integration Points

**App init:**
```
DbProvider mounts → DB ready → processRecurringRules(db, today)
  → generates confirmed/review/planned transactions
  → advances next_occurrence
  → emits events → app renders with current data
```

**Cashflow month navigation:**
```
Navigate to month X → if future month: populateFutureMonth(db, X)
  → compute occurrence per rule for month X
  → insert 'planned' if missing
  → render
```

**Recurring page CRUD:**
```
Create rule → if start_date <= today: run scheduler for this rule only (catch-up)
Edit rule → update fields, recalculate next_occurrence if frequency/anchor changed
Delete rule → existing transactions remain (FK ON DELETE SET NULL)
```

**Category creation fix:**
- All `handleCreateCategory` / `onCreateCategory` calls pass `is_income` based on transaction type context
- Recurring page: derived from which group (Income/Expense section)
- Cashflow page: derived from which table the inline add is in

### Export/Import

- Bump export format version to 3
- v3 exports include `anchor_day` and `is_variable` fields
- Importing v2 backups: auto-derive `anchor_day` from `start_date`, default `is_variable = 0`
- Pre-migration auto-backup: before v3→v4 migration, call `exportJSON()` and save via File System Access (if configured)

## Files Affected

| File | Change |
|------|--------|
| `src/db/schema.ts` | Bump SCHEMA_VERSION to 4, add migration 3, update CREATE_TABLES DDL |
| `src/lib/recurring.ts` | Rewrite `getNextOccurrence()` with UTC fix + anchor_day support |
| `src/db/queries/recurring.ts` | Rewrite `autoPopulateFutureTransactions` → new `processRecurringRules` + `populateFutureMonth` |
| `src/hooks/useRecurring.ts` | Remove dead `processDue`, wire scheduler on creation catch-up |
| `src/hooks/useCashflow.ts` | Call `populateFutureMonth` instead of `autoPopulateFutureTransactions` |
| `src/context/DbContext.tsx` | Run `processRecurringRules` once after DB init |
| `src/routes/recurring.tsx` | Full UI rewrite: Income/Expense groups, summary bar, inline add per group, fix category bug |
| `src/components/cashflow/SingleMonthView.tsx` | Add review banner, update StatusPill |
| `src/components/ui/StatusPill.tsx` (or wherever it lives) | Add 'review' variant (orange/amber) |
| `src/lib/export.ts` | Bump version to 3, add import compatibility logic |
| `src/types/database.ts` | Add `anchor_day`, `is_variable` to RecurringTransaction type |
| `worker/db-worker.ts` | Auto-backup before migration |
