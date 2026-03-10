# Recurring Engine Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the recurring transactions engine to fix date drift, add anchor-day support, variable-amount recurring, review status, and redesign the recurring page UI.

**Architecture:** Schema v3→v4 migration adds `anchor_day` and `is_variable` columns. A new unified `processRecurringRules()` scheduler replaces both `processDue()` and `autoPopulateFutureTransactions()`. It runs once on app init, catches up missed months, and generates transactions with correct statuses. The recurring page UI is rebuilt to mirror cashflow's Income/Expense grouping.

**Tech Stack:** TypeScript, React 19, wa-sqlite (WASM), Tailwind CSS v4, TanStack Router

**Design doc:** `docs/plans/2026-03-10-recurring-engine-rewrite.md`

---

### Task 1: Fix `getNextOccurrence()` UTC Bug + Add Anchor Day

**Files:**
- Modify: `src/lib/recurring.ts`
- Modify: `src/types/database.ts`

**Step 1: Update RecurringTransaction type**

In `src/types/database.ts`, add two fields to the `RecurringTransaction` interface:

```typescript
// Add after `is_active: number;`
anchor_day: number | null;
is_variable: number;
```

**Step 2: Rewrite `getNextOccurrence()` in `src/lib/recurring.ts`**

Replace the entire function with anchor-day-aware logic. New signature:

```typescript
export function getNextOccurrence(
  current: string,
  frequency: RecurringTransaction["frequency"],
  anchorDay?: number | null,
  customDays?: number | null
): string {
  const d = new Date(current + "T00:00:00");

  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;
    case "monthly":
      return advanceMonths(d, 1, anchorDay);
    case "quarterly":
      return advanceMonths(d, 3, anchorDay);
    case "yearly": {
      const y = d.getFullYear() + 1;
      const m = d.getMonth();
      const anchor = anchorDay ?? d.getDate();
      const maxDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(anchor, maxDay);
      return formatLocalDate(new Date(y, m, day));
    }
    case "custom":
      d.setDate(d.getDate() + (customDays ?? 1));
      break;
  }

  return formatLocalDate(d);
}

function advanceMonths(d: Date, months: number, anchorDay?: number | null): string {
  const m = d.getMonth() + months;
  const y = d.getFullYear();
  const anchor = anchorDay ?? d.getDate();
  const newDate = new Date(y, m, 1); // first of target month
  const maxDay = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
  const day = Math.min(anchor, maxDay);
  return formatLocalDate(new Date(newDate.getFullYear(), newDate.getMonth(), day));
}

/** Format Date as YYYY-MM-DD using local timezone (NOT UTC) */
export function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

**Step 3: Verify build compiles**

Run: `bun run build`
Expected: No type errors. (Callers of `getNextOccurrence` still work since the new params are optional.)

**Step 4: Commit**

```bash
git add src/lib/recurring.ts src/types/database.ts
git commit -m "fix: rewrite getNextOccurrence with UTC fix and anchor day support"
```

---

### Task 2: Schema Migration (v3 → v4)

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `worker/db-worker.ts`
- Modify: `src/lib/export.ts`

**Step 1: Update `CREATE_TABLES` DDL in `src/db/schema.ts`**

In the `recurring_transactions` CREATE TABLE statement, add two columns before `created_at`:

```sql
anchor_day INTEGER,
is_variable INTEGER NOT NULL DEFAULT 0,
```

Update `SCHEMA_VERSION` from `3` to `4`.

**Step 2: Add migration 3 to `MIGRATIONS` object**

```typescript
3: `
ALTER TABLE recurring_transactions ADD COLUMN anchor_day INTEGER;
ALTER TABLE recurring_transactions ADD COLUMN is_variable INTEGER NOT NULL DEFAULT 0;
UPDATE recurring_transactions
  SET anchor_day = CAST(substr(start_date, 9, 2) AS INTEGER)
  WHERE frequency IN ('monthly', 'quarterly', 'yearly');
`,
```

**Step 3: Add pre-migration auto-backup in `worker/db-worker.ts`**

In the `migrate()` function, before the migration loop, add a backup step. The worker can't use File System Access API directly, but it can export all data as JSON and send it to the main thread via postMessage. Instead, a simpler approach: store a backup snapshot in the `settings` table before migrating.

Add before the `for (let v = currentVersion...)` loop:

```typescript
// Pre-migration backup: stash current data in settings table
if (currentVersion < SCHEMA_VERSION) {
  try {
    const tables = ["categories", "transactions", "recurring_transactions", "settings", "tags"];
    const backup: Record<string, unknown[]> = {};
    for (const table of tables) {
      const result = await exec(`SELECT * FROM ${table}`);
      backup[table] = result.rows;
    }
    const json = JSON.stringify({ version: currentVersion, backup_at: new Date().toISOString(), ...backup });
    await exec(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('_pre_migration_backup', ?)`,
      [json]
    );
  } catch {
    // Non-fatal: best-effort backup
  }
}
```

**Step 4: Bump export version in `src/lib/export.ts`**

Change `version: 2` to `version: 3` in the `exportJSON` function.

**Step 5: Verify build compiles**

Run: `bun run build`

**Step 6: Commit**

```bash
git add src/db/schema.ts worker/db-worker.ts src/lib/export.ts
git commit -m "feat: schema v4 migration — add anchor_day, is_variable columns"
```

---

### Task 3: New Recurring Scheduler (`processRecurringRules`)

**Files:**
- Modify: `src/db/queries/recurring.ts` — replace `autoPopulateFutureTransactions`, add `processRecurringRules` and `populateFutureMonth`

**Step 1: Replace `autoPopulateFutureTransactions` with two new functions**

Delete `autoPopulateFutureTransactions` entirely. Add these two new exported functions:

```typescript
import { getNextOccurrence, formatLocalDate } from "../../lib/recurring.ts";

/**
 * Runs once on app init. Catches up all missed recurring occurrences
 * from each rule's next_occurrence through today. Creates transactions
 * with appropriate status (confirmed, review, or planned).
 */
export async function processRecurringRules(
  db: DbClient,
  today: string
): Promise<number> {
  const { rows: rules } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  let generated = 0;
  const todayMonth = today.slice(0, 7);

  for (const rule of rules) {
    let occ = rule.next_occurrence;

    // Catch up: generate for every missed occurrence up through today
    while (occ <= today) {
      if (rule.end_date && occ > rule.end_date) {
        await updateRecurring(db, rule.id, { is_active: false });
        break;
      }

      const exists = await transactionExists(db, rule.id, occ);
      if (!exists) {
        const status = rule.is_variable ? "review" : "confirmed";
        await db.exec(
          `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
          [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id, status]
        );
        generated++;
      }

      const next = getNextOccurrence(occ, rule.frequency, rule.anchor_day, rule.custom_interval_days);
      occ = next;
    }

    // Update next_occurrence to the advanced value
    if (occ !== rule.next_occurrence) {
      if (rule.end_date && occ > rule.end_date) {
        await updateRecurring(db, rule.id, { is_active: false });
      } else {
        await updateRecurring(db, rule.id, { next_occurrence: occ });
      }
    }

    // Current month future: if next_occurrence is in the current month but after today
    if (occ > today && occ.slice(0, 7) === todayMonth) {
      const exists = await transactionExists(db, rule.id, occ);
      if (!exists) {
        await db.exec(
          `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '')`,
          [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id]
        );
        generated++;
      }
    }
  }

  return generated;
}

/**
 * For navigating to a future month: generates 'planned' transactions
 * for any recurring rules that have an occurrence in that month.
 */
export async function populateFutureMonth(
  db: DbClient,
  month: string
): Promise<void> {
  const { rows: rules } = await db.exec<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE is_active = 1"
  );

  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthStart = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  for (const rule of rules) {
    // Check if transaction already exists for this rule in this month
    const { rows: existing } = await db.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = ?`,
      [rule.id, month]
    );
    if ((existing[0]?.count ?? 0) > 0) continue;

    // Compute occurrence for this month
    const occ = computeOccurrenceForMonth(rule, monthStart, monthEnd);
    if (!occ) continue;
    if (rule.end_date && occ > rule.end_date) continue;

    await db.exec(
      `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', '')`,
      [crypto.randomUUID(), rule.amount, rule.type, rule.category_id, occ, rule.payee, rule.notes, rule.id]
    );
  }
}

async function transactionExists(db: DbClient, recurringId: string, date: string): Promise<boolean> {
  const { rows } = await db.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM transactions WHERE recurring_id = ? AND date = ?",
    [recurringId, date]
  );
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Given a recurring rule, compute the specific date it falls on
 * within [monthStart, monthEnd], or null if no occurrence.
 */
function computeOccurrenceForMonth(
  rule: RecurringTransaction,
  monthStart: string,
  monthEnd: string
): string | null {
  const freq = rule.frequency;

  // For month-based frequencies with anchor_day, direct calculation
  if ((freq === "monthly" || freq === "quarterly" || freq === "yearly") && rule.anchor_day) {
    const [y, m] = monthStart.split("-").map(Number) as [number, number];
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(rule.anchor_day, maxDay);
    const occ = `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;

    // For quarterly: check if this month is a valid quarter step from start
    if (freq === "quarterly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      const thisMonth = m;
      if ((thisMonth - startMonth + 12) % 3 !== 0) return null;
    }
    // For yearly: check if this is the correct month
    if (freq === "yearly") {
      const startMonth = parseInt(rule.start_date.slice(5, 7), 10);
      if (m !== startMonth) return null;
    }

    if (occ >= monthStart && occ <= monthEnd && occ >= rule.start_date) return occ;
    return null;
  }

  // For day-based frequencies: step forward from next_occurrence
  let occ = rule.next_occurrence;
  // If occ is before the target month, advance until we reach it
  while (occ < monthStart) {
    occ = getNextOccurrence(occ, freq, rule.anchor_day, rule.custom_interval_days);
    if (rule.end_date && occ > rule.end_date) return null;
  }

  if (occ >= monthStart && occ <= monthEnd) return occ;
  return null;
}
```

**Step 2: Update the `getDueRecurring` export** (keep it — used by scheduler) and remove old `autoPopulateFutureTransactions` export.

**Step 3: Verify build compiles**

Run: `bun run build`

**Step 4: Commit**

```bash
git add src/db/queries/recurring.ts
git commit -m "feat: new recurring scheduler replacing autoPopulateFutureTransactions"
```

---

### Task 4: Wire Scheduler into App Init + Update Cashflow Hook

**Files:**
- Modify: `src/context/DbContext.tsx` — run scheduler on mount
- Modify: `src/hooks/useCashflow.ts` — use `populateFutureMonth` instead of `autoPopulateFutureTransactions`
- Modify: `src/hooks/useRecurring.ts` — remove dead `processDue`, add catch-up on rule creation

**Step 1: Update `DbContext.tsx` — run scheduler after DB is ready**

Import and run `processRecurringRules` once after the DB becomes ready. Add a `useEffect` that runs once when `ready` flips to `true`:

```typescript
import { processRecurringRules } from "../db/queries/recurring.ts";
import { formatLocalDate } from "../lib/recurring.ts";
import { emitDbEvent } from "../lib/db-events.ts";

// Inside DbProvider, after the existing useEffect:
const [schedulerRan, setSchedulerRan] = useState(false);

useEffect(() => {
  if (!ready || schedulerRan) return;
  setSchedulerRan(true);
  const today = formatLocalDate(new Date());
  processRecurringRules(client, today).then((count) => {
    if (count > 0) {
      emitDbEvent("transactions-changed");
      emitDbEvent("recurring-changed");
    }
  });
}, [ready, schedulerRan]);
```

**Step 2: Update `useCashflow.ts`**

Replace `autoPopulateFutureTransactions` import with `populateFutureMonth`:

```typescript
import { populateFutureMonth, createRecurring } from "../db/queries/recurring.ts";
```

In the `refresh` callback, replace:
```typescript
await autoPopulateFutureTransactions(db, month);
```
with:
```typescript
await populateFutureMonth(db, month);
```

**Step 3: Update `useRecurring.ts`**

Remove the `processDue` function entirely. Remove its import of `getDueRecurring`.

In the `add` function, after creating the rule, if `start_date <= today`, run `processRecurringRules` for catch-up. Simplest approach: import and call it:

```typescript
import { processRecurringRules } from "../db/queries/recurring.ts";
import { formatLocalDate } from "../lib/recurring.ts";

// In the add callback, after createRecurring + emitDbEvent:
const today = formatLocalDate(new Date());
if (rec.start_date <= today) {
  const count = await processRecurringRules(db, today);
  if (count > 0) {
    emitDbEvent("transactions-changed");
  }
}
```

Remove `processDue` from the return object.

**Step 4: Verify build compiles**

Run: `bun run build`

**Step 5: Manual test**

Run: `bun run dev`
- Create a recurring monthly rule with a start date 3 months ago
- Verify: transactions auto-generated for each missed month with `confirmed` status
- Navigate to a future month: verify planned transaction appears
- Check that the anchor day stays fixed (e.g., always the 24th)

**Step 6: Commit**

```bash
git add src/context/DbContext.tsx src/hooks/useCashflow.ts src/hooks/useRecurring.ts
git commit -m "feat: wire recurring scheduler into app init and cashflow hook"
```

---

### Task 5: StatusPill — Extract + Add 'review' Variant

**Files:**
- Create: `src/components/ui/StatusPill.tsx`
- Modify: `src/components/cashflow/SingleMonthView.tsx` — import from new file, remove inline definition

**Step 1: Create `src/components/ui/StatusPill.tsx`**

Extract the existing `StatusPill` from `SingleMonthView.tsx` (currently lines ~639-657) into its own file, adding the `review` variant:

```typescript
export type TransactionStatus = "planned" | "confirmed" | "review";

export function StatusPill({
  status,
  onClick,
  disabled,
}: {
  status: TransactionStatus;
  onClick: () => void;
  disabled?: boolean;
}) {
  const config = {
    planned: {
      className: "border border-dashed border-border-dark text-text-light hover:border-accent hover:text-accent",
      dotClass: "bg-text-light/50",
      label: "Plan",
      title: "Mark as confirmed",
    },
    confirmed: {
      className: "bg-success/10 text-success hover:bg-success/20",
      dotClass: "bg-success",
      label: "Conf",
      title: "Mark as planned",
    },
    review: {
      className: "bg-warning/10 text-warning border border-dashed border-warning/30 hover:bg-warning/20",
      dotClass: "bg-warning",
      label: "Review",
      title: "Needs amount review — click to confirm",
    },
  }[status];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer leading-tight ${config.className}`}
      title={config.title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </button>
  );
}
```

**Step 2: Update SingleMonthView.tsx**

Remove the inline `StatusPill` function. Add import at top:

```typescript
import { StatusPill, type TransactionStatus } from "../ui/StatusPill.tsx";
```

Update the `onToggleStatus` type and any inline status type annotations to use `TransactionStatus` where appropriate.

**Step 3: Check `--color-warning` CSS variable exists**

Search `src/globals.css` for `--color-warning`. If it doesn't exist, add it to the `@theme` block:

```css
--color-warning: oklch(0.75 0.15 75);
```

**Step 4: Verify build compiles**

Run: `bun run build`

**Step 5: Commit**

```bash
git add src/components/ui/StatusPill.tsx src/components/cashflow/SingleMonthView.tsx src/globals.css
git commit -m "refactor: extract StatusPill component, add review variant"
```

---

### Task 6: Review Banner on Cashflow Page

**Files:**
- Modify: `src/components/cashflow/SingleMonthView.tsx` — add banner above tables when review-status transactions exist

**Step 1: Add ReviewBanner component**

Add a `ReviewBanner` function component in `SingleMonthView.tsx` (or as a separate file if preferred). Place it between the summary strip and the income table:

```typescript
function ReviewBanner({ count, onReview }: { count: number; onReview: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-warning/10 border border-warning/20 rounded-xl text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0" />
        <span className="text-text">
          <strong>{count}</strong> recurring {count === 1 ? "item needs" : "items need"} updated amounts
        </span>
      </div>
      <button
        type="button"
        onClick={onReview}
        className="text-warning font-semibold hover:underline cursor-pointer shrink-0"
      >
        Review
      </button>
    </div>
  );
}
```

**Step 2: Wire into SingleMonthView**

Compute `reviewCount` from the groups data. Add a ref for scrolling to the first review row. In the JSX, render `<ReviewBanner>` between summary and income table:

```typescript
// Inside SingleMonthView:
const reviewCount = [...incomeGroups, ...expenseGroups]
  .flatMap(g => g.rows)
  .filter(r => r.status === "review").length;

const firstReviewRef = useRef<HTMLDivElement>(null);

// In JSX, after summary strip:
<ReviewBanner count={reviewCount} onReview={() => firstReviewRef.current?.scrollIntoView({ behavior: "smooth" })} />
```

Mark the first review-status row with `ref={firstReviewRef}` in the row rendering logic.

**Step 3: Update the status toggle handler**

When toggling a `review` status transaction, it should go to `confirmed` (not cycle to planned). Update the `onToggleStatus` caller logic:

```typescript
// Status cycle: review → confirmed, planned → confirmed, confirmed → planned
const nextStatus = status === "confirmed" ? "planned" : "confirmed";
```

**Step 4: Auto-confirm on save for review transactions**

In `useCashflow.ts` `editTransaction`, if the transaction being edited has `status === 'review'`, automatically set status to `'confirmed'`:

```typescript
// In editTransaction callback, after the update:
// If the edit didn't explicitly set status but the txn was 'review', auto-confirm
if (!updates.status) {
  const txn = transactions.find(t => t.id === id);
  if (txn?.status === "review") {
    await updateTransaction(db, id, { status: "confirmed" });
  }
}
```

Also update the recurring rule's amount when a variable-amount review transaction is confirmed — find the linked `recurring_id` and update its amount:

```typescript
if (txn?.status === "review" && txn.recurring_id && updates.amount !== undefined) {
  await updateRecurring(db, txn.recurring_id, { amount: updates.amount });
  emitDbEvent("recurring-changed");
}
```

Import `updateRecurring` from `../db/queries/recurring.ts`.

**Step 5: Verify build compiles**

Run: `bun run build`

**Step 6: Commit**

```bash
git add src/components/cashflow/SingleMonthView.tsx src/hooks/useCashflow.ts
git commit -m "feat: add review banner and auto-confirm for variable recurring"
```

---

### Task 7: Recurring Page UI Redesign

**Files:**
- Modify: `src/routes/recurring.tsx` — full rewrite

**This is the largest task. The recurring page gets rebuilt to mirror the cashflow layout.**

**Step 1: Rewrite the `RecurringPage` component**

Replace the entire `RecurringPage` function. Key structural changes:

1. **Summary bar** at top — three cards: Recurring Income, Recurring Expenses, Net
2. **Income group** — table with header + rows for `items.filter(r => r.is_active && r.type === 'income')`
3. **Expense group** — same for expense
4. **Inline add** at bottom of each group (not a top-level button)
5. **Inactive** collapsible at bottom (unchanged behavior)

Summary bar reuses the same visual pattern as cashflow's `SummaryCard`:

```typescript
function RecurringSummary({ income, expenses }: { income: number; expenses: number }) {
  const net = income - expenses;
  return (
    <div className="flex items-stretch gap-3 overflow-x-auto">
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Recurring Income</div>
        <div className="text-lg font-bold tabular-nums text-success">{formatCurrency(income)}</div>
      </div>
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Recurring Expenses</div>
        <div className="text-lg font-bold tabular-nums">{formatCurrency(expenses)}</div>
      </div>
      <div className="flex-1 min-w-[140px] bg-surface rounded-xl border border-border p-3">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Net</div>
        <div className={`text-lg font-bold tabular-nums ${net >= 0 ? "text-success" : "text-danger"}`}>
          {net >= 0 ? "+" : ""}{formatCurrency(Math.abs(net))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Split items into groups**

```typescript
const activeIncome = items.filter(r => r.is_active && r.type === "income");
const activeExpense = items.filter(r => r.is_active && r.type === "expense");
const inactive = items.filter(r => !r.is_active);

const incomeTotal = activeIncome.reduce((s, r) => s + r.amount, 0);
const expenseTotal = activeExpense.reduce((s, r) => s + r.amount, 0);
```

**Step 3: Create `RecurringGroup` component**

Renders a section header (e.g., "INCOME" with total), the table with grid, rows, and an inline-add row at the bottom:

```typescript
function RecurringGroup({
  type,
  items,
  total,
  categories,
  editingId,
  onEdit,
  onToggleActive,
  onDelete,
  onCreateCategory,
  onAdd,
  onUpdate,
  setEditingId,
}: {
  type: "income" | "expense";
  items: RecurringTransaction[];
  total: number;
  categories: Category[];
  editingId: string | null;
  onEdit: (id: string) => void;
  onToggleActive: (item: RecurringTransaction) => void;
  onDelete: (id: string) => void;
  onCreateCategory: (name: string, isIncome: boolean) => Promise<string>;
  onAdd: (data: FormData) => Promise<void>;
  onUpdate: (id: string, data: FormData) => Promise<void>;
  setEditingId: (id: string | null) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const isIncome = type === "income";
  const label = isIncome ? "Income" : "Expenses";

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className={`text-sm font-bold uppercase tracking-wider ${isIncome ? "text-success" : "text-text-muted"}`}>
          {label}
        </h2>
        <span className="text-sm font-semibold tabular-nums text-text-muted">
          {isIncome ? "+" : ""}{formatCurrency(total)}
        </span>
      </div>

      <div className="bg-surface rounded-xl border border-border">
        {/* Grid header */}
        <div className="grid grid-cols-[1fr_100px_88px_96px_96px_100px_72px] gap-2 px-4 py-2.5 border-b border-border bg-surface-alt rounded-t-xl text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          <div>Payee</div>
          <div>Amount</div>
          <div>Frequency</div>
          <div>Category</div>
          <div>Start</div>
          <div>End</div>
          <div className="text-right">Actions</div>
        </div>

        {/* Rows */}
        {items.map(item =>
          editingId === item.id ? (
            <RecurringForm
              key={item.id}
              type={type}
              categories={categories}
              onCreateCategory={onCreateCategory}
              initial={item}
              inline
              onSubmit={async (data) => {
                await onUpdate(item.id, data);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <RecurringRow
              key={item.id}
              item={item}
              categories={categories}
              onEdit={() => onEdit(item.id)}
              onToggleActive={() => onToggleActive(item)}
              onDelete={() => onDelete(item.id)}
            />
          )
        )}

        {/* Empty state */}
        {items.length === 0 && !showAdd && (
          <div className="px-4 py-6 text-center text-text-muted text-sm">
            No recurring {type} rules
          </div>
        )}

        {/* Inline add */}
        {showAdd ? (
          <RecurringForm
            type={type}
            categories={categories}
            onCreateCategory={onCreateCategory}
            inline
            onSubmit={async (data) => {
              await onAdd(data);
              setShowAdd(false);
            }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="w-full text-left px-4 py-2.5 text-sm text-text-light hover:text-accent hover:bg-surface-alt/50 transition-colors cursor-pointer border-t border-border"
          >
            + Add {type} rule
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Fix category creation bug**

Update `RecurringForm` to accept a `type` prop (locked to the group's type). The `onCreateCategory` now receives `isIncome`:

```typescript
// In RecurringForm:
async function handleCreateCategory(name: string): Promise<string> {
  return onCreateCategory(name, type === "income");
}
```

In `RecurringPage`, update the category creation handler:

```typescript
async function handleCreateCategory(name: string, isIncome: boolean): Promise<string> {
  const id = await addCategory({ name, color: "#64748b", is_income: isIncome });
  return id;
}
```

**Step 5: Update `RecurringForm` to support `is_variable` toggle**

Add a checkbox/toggle for "Variable amount" in the form:

```typescript
const [isVariable, setIsVariable] = useState(initial?.is_variable === 1);

// In the form grid, after the amount input:
<label className="flex items-center gap-1.5 cursor-pointer">
  <input
    type="checkbox"
    checked={isVariable}
    onChange={(e) => setIsVariable(e.target.checked)}
    className="accent-accent"
  />
  <span className="text-xs text-text-muted">Variable amount</span>
</label>

// In handleSubmit, include is_variable:
await onSubmit({
  ...otherFields,
  is_variable: isVariable,
});
```

**Step 6: Update `RecurringRow` to show variable indicator**

In the Amount column, if `item.is_variable`, show `~` prefix:

```typescript
<div className={`text-sm tabular-nums ${isIncome ? "text-success" : ""}`}>
  {item.is_variable ? "~" : ""}{isIncome ? "+" : ""}{formatCurrency(item.amount)}
  {item.is_variable && <span className="ml-1 text-warning text-xs" title="Variable amount">⚡</span>}
</div>
```

**Step 7: Update form data type and add handler**

The `FormData` interface needs `is_variable`:

```typescript
interface FormData {
  amount: number;
  type: "income" | "expense";
  category_id: string | null;
  payee: string;
  notes: string;
  frequency: RecurringTransaction["frequency"];
  start_date: string;
  end_date: string | null;
  mode: "reminder" | "auto";
  is_variable?: boolean;
}
```

Update the `useRecurring` hook's `add` function to pass `is_variable` and `anchor_day`:

In `useRecurring.ts`, the `add` callback should compute `anchor_day` from `start_date` for monthly/quarterly/yearly:

```typescript
const anchorDay = ["monthly", "quarterly", "yearly"].includes(rec.frequency)
  ? parseInt(rec.start_date.slice(8, 10), 10)
  : null;

await createRecurring(db, {
  ...rec,
  id,
  next_occurrence: rec.start_date,
  anchor_day: anchorDay,
});
```

Similarly update the `createRecurring` function signature in `src/db/queries/recurring.ts` to accept `anchor_day` and `is_variable`.

**Step 8: Verify build compiles**

Run: `bun run build`

**Step 9: Manual test**

Run: `bun run dev`
- Navigate to `/recurring`
- Verify Income and Expense sections render separately
- Create income rule — verify category dropdown shows income categories
- Create expense rule with "Variable amount" checked — verify `~` and ⚡ indicators
- Check summary bar totals update
- Verify inline add at bottom of each group works
- Verify edit/delete/pause actions still work

**Step 10: Commit**

```bash
git add src/routes/recurring.tsx src/hooks/useRecurring.ts src/db/queries/recurring.ts
git commit -m "feat: redesign recurring page with income/expense groups and variable amount support"
```

---

### Task 8: Fix Category Bug Across Entire App

**Files:**
- Modify: `src/components/cashflow/SingleMonthView.tsx` — audit inline category creation

**Step 1: Audit and fix all `onCreateCategory` call sites**

Search all files for `onCreateCategory` and `handleCreateCategory` to verify `is_income` is passed correctly based on context.

The cashflow page's `SingleMonthView` already receives `onCreateCategory` with an `isIncome` parameter. Verify the caller in the route passes it correctly:

In `src/routes/index.tsx`, check how `onCreateCategory` is implemented. It should use the transaction `type` to determine `is_income`:

```typescript
onCreateCategory={async (name: string, isIncome: boolean) => {
  const id = await addCategory({ name, color: "#64748b", is_income: isIncome });
  return id;
}}
```

**Step 2: Verify build compiles**

Run: `bun run build`

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: ensure is_income correctly derived in all category creation paths"
```

---

### Task 9: Update Export/Import Compatibility

**Files:**
- Modify: `src/lib/export.ts`

**Step 1: Add import compatibility for v2 backups**

If there's an import function (or add one if none exists), handle v2 format:

```typescript
export function normalizeImportData(data: any): any {
  if (data.version < 3) {
    // Backfill anchor_day for old recurring rules
    if (data.recurring_transactions) {
      for (const rule of data.recurring_transactions) {
        if (!rule.anchor_day && ["monthly", "quarterly", "yearly"].includes(rule.frequency)) {
          rule.anchor_day = parseInt(rule.start_date?.slice(8, 10) ?? "1", 10);
        }
        if (rule.is_variable === undefined) {
          rule.is_variable = 0;
        }
      }
    }
  }
  return data;
}
```

**Step 2: Verify build compiles**

Run: `bun run build`

**Step 3: Commit**

```bash
git add src/lib/export.ts
git commit -m "feat: add v2→v3 import compatibility for recurring transactions"
```

---

### Task 10: Final Integration Test + Changelog

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Full manual test sequence**

Run: `bun run dev`

Test checklist:
- [ ] Fresh DB: tables created with new schema, seed works
- [ ] Existing DB: migration adds columns, backfills anchor_day, pre-migration backup saved
- [ ] Create monthly recurring on the 31st — verify Feb shows 28th, Mar shows 31st
- [ ] Create recurring with start_date 6 months ago — verify all missed months auto-generated as confirmed
- [ ] Create variable-amount recurring — verify review status, banner appears
- [ ] Edit review transaction — verify auto-confirms and updates rule's amount
- [ ] Navigate to future month — verify planned transactions appear
- [ ] Recurring page: Income/Expense groups, summary bar, inline add
- [ ] Create income category inline from income group — verify it's marked as income
- [ ] Export JSON — verify version 3 with new fields
- [ ] Inactive rules section still works (pause/resume/delete)

**Step 2: Production build check**

Run: `bun run build`
Verify no errors or warnings.

**Step 3: Update CHANGELOG.md**

Add a new version entry (determine version based on semver — this is MINOR since it adds features):

```markdown
## [2.2.0] - 2026-03-10

### Added
- Variable-amount recurring transactions with "review" status and cashflow banner
- Recurring page redesigned with separate Income/Expense groups and summary bar
- Anchor-day support for monthly/quarterly/yearly recurring (always lands on same day-of-month)
- Auto-generation of recurring transactions on app startup (catches up missed months)
- Pre-migration auto-backup for schema upgrades

### Fixed
- Date drift bug: monthly recurring losing one day per iteration in UTC+ timezones
- Past recurring transactions now auto-set to "confirmed" instead of "planned"
- Inline category creation from income recurring rules now correctly marks category as income
- Removed dead `processDue()` code from useRecurring hook

### Changed
- Schema version 3 → 4 (added anchor_day, is_variable columns)
- Export format version 2 → 3 (backward-compatible import of v2 backups)
- StatusPill extracted to shared component with three variants (planned/confirmed/review)
```

**Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog with v2.2.0 — recurring engine rewrite"
```
