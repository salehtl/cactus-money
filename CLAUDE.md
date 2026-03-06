# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal finance PWA (YNAB-like). Local-first, no server dependency. Currency: AED (UAE Dirham). Light theme only.

## Stack

- Runtime: Bun
- Framework: React 19 + TanStack Router (SPA, file-based routes)
- Build: Vite 7
- Styling: Tailwind CSS v4 (`@theme` block in globals.css for design tokens)
- UI: Custom shadcn-inspired components (no Radix dependency — built on native HTML elements)
- Charts: Recharts
- Database: wa-sqlite (WASM) via Web Worker — OPFS primary, IndexedDB fallback
- PWA: vite-plugin-pwa + Workbox
- Validation: Zod
- Language: TypeScript (strict mode)

## Commands

- `bun run dev` — Start dev server
- `bun run build` — Production build
- `bun run preview` — Preview production build

## Architecture

### Database Layer

The DB is the single source of truth — no external state library.

1. **Web Worker** (`worker/db-worker.ts`) — Runs wa-sqlite async, initializes with OPFS (falls back to IndexedDB), enables WAL mode and foreign keys
2. **DbClient** (`src/db/client.ts`) — Promise-based `exec<T>(sql, params)` wrapping postMessage/onmessage with request ID tracking
3. **React Context** (`src/context/DbContext.tsx`) — Provides singleton DbClient via `useDb()` hook, handles loading/error states
4. **Schema** (`src/db/schema.ts`) — All DDL, versioned via `PRAGMA user_version` (currently version 3)
5. **Query Modules** (`src/db/queries/`) — Typed async functions accepting DbClient: `transactions.ts`, `categories.ts`, `recurring.ts`, `settings.ts`, `cashflow.ts`
6. **Seed Data** (`src/db/seed.ts`) — ~30 default categories with hierarchy, colors, icons

### Data Flow

```
Component -> Custom Hook (useTransactions, useCategories, etc.)
  -> db.exec(sql, params) -> Worker -> wa-sqlite -> result
  -> After mutation: emitDbEvent("transactions-changed")
  -> Other hooks subscribed via onDbEvent() auto-refresh
```

### Event Bus (`src/lib/db-events.ts`)

Simple EventTarget pub/sub for cross-hook cache invalidation. Event types: `transactions-changed`, `categories-changed`, `recurring-changed`, `settings-changed`, `tags-changed`.

### Routes

TanStack Router file-based routing in `src/routes/`. Auto-generates `routeTree.gen.ts` via plugin. Each route exports via `createFileRoute()`.

- `__root.tsx` — Layout: wraps app with DbProvider, ToastProvider, Sidebar, MobileNav
- `index.tsx` — Cashflow page (single-month view with inline add/edit)
- `overview.tsx` — Multi-month overview with chart and pivot grid
- `settings.tsx`

### Custom Hooks (`src/hooks/`)

Each hook calls `useDb()`, provides `{ data, loading, refresh, add, update, remove }` pattern, and subscribes to the event bus for auto-refresh.

### Cashflow Page (`src/components/cashflow/`)

The main page. Income and Expense tables with inline add/edit rows sharing a 7-column grid (`GRID_COLS` constant in `SingleMonthView.tsx`):

- **Columns:** Payee | Date | Category | Recur | Amount | Status | Actions
- **Inline add:** Same grid layout — all fields editable inline (payee, date, category, recurring frequency, amount, status). Group selector appears as secondary row when groups exist.
- **Inline edit:** Double-click row or click pencil icon to edit in-place with same grid. Enter saves, Esc cancels.
- **Empty state:** Always shows table structure with headers + "Add item" row (no EmptyState component).
- **Recurring:** Frequency column shows abbreviated labels (Mo, Wk, Qt, Yr). Transactions joined with `recurring_transactions` table to get `recurring_frequency`.
- **Data flow:** `useCashflow` hook → `buildCashflowRows()` → `CashflowRow` type includes `frequency` field.
- **StatusPill:** Shared component for plan/confirmed toggle used in display, edit, and add modes.
- **CategoryCombo:** Custom combobox (no Radix) with full ARIA compliance (`role="combobox"`, `listbox`, `option`, `aria-activedescendant`, `aria-expanded`) and keyboard nav (Arrow Up/Down, Enter, Escape, Home/End, Tab). Supports filtering existing categories and inline creation of new ones. Z-index: `z-[60]` for dropdown (above action menus at `z-50`).
- **Z-index layers:** Action menus `z-[70]` > CategoryCombo dropdown `z-[60]`. Table container must NOT use `overflow-hidden` — use `rounded-t-xl` on header instead.
- **Inline add drafts:** Persisted to `sessionStorage` (keyed `cashflow-draft-income`/`cashflow-draft-expense`) so navigation doesn't lose in-progress rows.
- **Smart status default:** Future-dated transactions auto-set to "planned"; manual toggle overrides auto-behavior.
- **Row interactions:** Double-click enters edit mode. Actions column has edit pencil + menu dots. Menu includes Duplicate, Stop recurrence, Delete.

## Key Conventions

- **Font:** TX-02 (OTF files in `public/fonts/`)
- **Colors:** CSS variables in `src/globals.css` using custom naming (`--color-accent`, `--color-surface`, `--color-text-muted`, etc.)
- **Formatting:** `formatCurrency()`, `formatDate()`, `getCurrentMonth()` from `src/lib/format.ts`
- **Toasts:** Custom ToastProvider context (`src/components/ui/Toast.tsx`) — use `useToast()` hook
- **Modals/Dialogs:** `<Modal />` wrapping HTML `<dialog>`, `<ConfirmDialog />` for confirm/cancel
- **UI Components** (`src/components/ui/`): Button (variants: primary/secondary/danger/ghost), Input, Select, Modal, ConfirmDialog, MonthPicker, MonthRangePicker, Toast
- **Icons:** Inline SVG components defined in component files (not using an icon library)
- **Path alias:** `@/*` maps to `./src/*`

## Important Config (vite.config.ts)

- **COOP/COEP headers** required for OPFS: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
- **Worker format:** ES modules
- **wa-sqlite** excluded from optimizeDeps (installed from `github:rhashimoto/wa-sqlite`, not npm)

## Schema (Tables)

`categories` (hierarchical, color/icon, is_income/is_system flags) | `transactions` (amount, type, category_id, date, payee, notes, recurring_id, status, group_name) | `recurring_transactions` (frequency, next_occurrence, mode — joined via `transactions.recurring_id`) | `tags` + `transaction_tags` (many-to-many) | `budgets` (category budgets by month) | `settings` (key-value store)
