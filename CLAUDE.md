# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal finance PWA (YNAB-like), named "cactus-money". Local-first, no server dependency. Currency: AED (UAE Dirham). Light theme only. Deployed to Cloudflare Pages.

## Changelog

**CHANGELOG.md must be updated prior to any push or merge to master.** Every user-facing change — feature, fix, or breaking change — must have a corresponding entry before the work is considered complete. Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — incompatible changes (schema migrations that lose data, removed features)
- **MINOR** — new features, non-breaking enhancements
- **PATCH** — bug fixes, performance improvements, internal refactors

Format: [Keep a Changelog](https://keepachangelog.com/) (`Added`, `Changed`, `Fixed`, `Removed` sections under each version). Changes on master are considered released — assign a version immediately (don't use `[Unreleased]`).

## Stack

- Runtime: Bun
- Framework: React 19 + TanStack Router (SPA, file-based routes)
- Build: Vite 7
- Styling: Tailwind CSS v4 (`@theme` block in globals.css for design tokens)
- UI: Custom shadcn-inspired components (no Radix dependency — built on native HTML elements)
- Charts: Recharts
- Database: wa-sqlite (WASM) via Web Worker — OPFS primary, IndexedDB fallback
- PWA: vite-plugin-pwa + Workbox
- Language: TypeScript (strict mode)

## Commands

- `bun run dev` — Start dev server
- `bun run build` — Production build
- `bun run preview` — Preview production build
- `bun run test` — Run tests (Vitest)
- `bun run test:watch` — Run tests in watch mode
- `bun run test:coverage` — Run tests with coverage
- `bunx vitest run src/path/to/file.test.ts` — Run a single test file
- `bun run deploy` — Build and deploy to Cloudflare Pages (`wrangler pages deploy dist`)
- `bun run preview:prod` — Build and preview with Cloudflare Pages dev server

## Testing

- **Runner:** Vitest (separate `vitest.config.ts` — NOT merged into vite.config.ts due to middleware plugin conflicts)
- **DOM:** happy-dom
- **DB tests:** better-sqlite3 in-memory SQLite via `src/test/db-helpers.ts` (`createTestDb()`)
- **Component tests:** @testing-library/react + `src/test/render-helpers.tsx` (`renderWithProviders()`)
- **Globals:** `globals: true` — do NOT import `describe`, `it`, `expect`, `vi` from vitest
- **Files:** Colocated `*.test.ts` / `*.test.tsx` next to source
- **Time-dependent tests:** Always use `vi.setSystemTime()` — never assert against live `new Date()`
- **DB helper gotcha:** Schema creation disables `foreign_keys` (table ordering issue), re-enables after. WAL pragma is no-op on `:memory:` — don't add it.

## Architecture

### Database Layer

The DB is the single source of truth — no external state library.

1. **Web Worker** (`worker/db-worker.ts`) — Runs wa-sqlite async, initializes with OPFS (falls back to IndexedDB), enables WAL mode and foreign keys
2. **DbClient** (`src/db/client.ts`) — Promise-based `exec<T>(sql, params)` wrapping postMessage/onmessage with request ID tracking
3. **React Context** (`src/context/DbContext.tsx`) — Provides singleton DbClient via `useDb()` hook, handles loading/error states
4. **Schema** (`src/db/schema.ts`) — All DDL, versioned via `PRAGMA user_version` (currently version 5)
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

- `__root.tsx` — Layout: wraps app with DbProvider, ToastProvider, Sidebar, MobileNav, PwaUpdater
- `index.tsx` — Cashflow page (single-month view with inline add/edit)
- `overview.tsx` — Multi-month overview with Summary (KPIs, charts) and Detailed (pivot grid) tabs
- `categories.tsx` — Category management with two-column layout
- `recurring.tsx` — Recurring rules management with inline editing
- `zakat.tsx` — Zakat calculator with madhab-aware engine
- `settings.tsx`

### Custom Hooks (`src/hooks/`)

Each hook calls `useDb()`, provides `{ data, loading, refresh, add, update, remove }` pattern, and subscribes to the event bus for auto-refresh.

### Cashflow Page (`src/components/cashflow/`)

The main page. Income and Expense tables with click-to-edit cells, keyboard navigation, multi-select, and bulk actions.

#### Table Infrastructure (`src/components/cashflow/table/`)

Shared, parameterizable table system reused by both cashflow and recurring pages:

- **`types.ts`** — Grid layout (`GRID_COLS`), column definitions (`COLUMNS`, `COLUMN_INDEX`, `TABBABLE_COLUMNS`), generic `TableState`/`TableAction`/`RegisteredAction`/`ActionContext` types
- **`useTableState.ts`** — `useReducer`-based state (focus, edit, selection). Accepts optional `TableColumnConfig` to customize columns for different pages.
- **`useTableKeyboard.ts`** — Keyboard handler: arrows/j/k/h/l navigation, Enter to edit, Escape to cancel, Space/x to select, Cmd+A select all. Accepts optional `columnsCount`, `defaultEditCol`, `onCopy`/`onPaste` callbacks.
- **`cells/`** — Reusable cell components: `PayeeCell`, `AmountCell`, `DateCell`, `CategoryCell`, `FrequencyCell` (with `required` prop), `StatusCell`, `ActionsCell`, `CellWrapper`
- **`actions.ts`** — Factory `createActions()` returning `RegisteredAction[]` with keyboard shortcuts
- **`TransactionTable.tsx`** — Orchestrator composing header, rows, inline add, bulk bar
- **`TransactionRow.tsx`** — `React.memo`-wrapped row with per-cell editing
- **`InlineAddRow.tsx`** — Grid-based add with draft persistence to sessionStorage
- **`BulkActionBar.tsx`** — Fixed bar for bulk status/category/delete on selected rows

**Key patterns for new table pages:**
1. Define column types in `types.ts` (grid cols, column index, tabbable columns, `TableColumnConfig`)
2. Pass config to `useTableState(config)` and `useTableKeyboard({ columnsCount, defaultEditCol })`
3. Create action registry via factory function
4. Reuse shared cell components from `cashflow/table/cells/`
5. Compose orchestrator table component

#### Cashflow-specific
- **Columns:** Checkbox | Payee | Date | Category | Recur | Amount | Status | Actions
- **Inline add:** All fields editable inline. Group selector appears as secondary row when groups exist.
- **Empty state:** Always shows table structure with headers + "Add item" row (no EmptyState component).
- **Data flow:** `useCashflow` hook → `buildCashflowRows()` → `CashflowRow` type includes `frequency` field.
- **StatusPill:** Shared component for plan/confirmed toggle used in display, edit, and add modes.
- **CategoryCombo:** Custom combobox (no Radix) with full ARIA compliance (`role="combobox"`, `listbox`, `option`, `aria-activedescendant`, `aria-expanded`) and keyboard nav (Arrow Up/Down, Enter, Escape, Home/End, Tab). Supports filtering existing categories and inline creation of new ones. Z-index: `z-[60]` for dropdown (above action menus at `z-50`).
- **Z-index layers:** Action menus `z-[70]` > CategoryCombo dropdown `z-[60]`. Table container must NOT use `overflow-hidden` — use `rounded-t-xl` on header instead.
- **Draft persistence:** sessionStorage keyed `cashflow-draft-income`/`cashflow-draft-expense`.
- **Smart status default:** Future-dated transactions auto-set to "planned"; manual toggle overrides auto-behavior.
- **Row interactions:** Click cell to edit, arrows/Tab to navigate. Actions menu: Duplicate, Stop recurrence, Delete.

### Recurring Page (`src/routes/recurring.tsx`, `src/components/recurring/table/`)

Recurring rules management using the shared table infrastructure. Route file is a thin orchestrator (~160 lines).

- **Components:** `RecurringTable` (orchestrator), `RecurringRow` (memo-wrapped), `EndDateCell` (nullable date), `RecurringActionsCell` (Pause/Resume + Delete), `RecurringInlineAddRow`, `RecurringBulkActionBar`
- **Columns:** Checkbox | Payee | Amount | Frequency | Category | Start | End | Actions
- **Grid:** `grid-cols-[16px_1fr_100px_52px_1fr_96px_100px_48px]`
- **Cell editing:** Click-to-edit per cell, reuses PayeeCell, AmountCell, FrequencyCell (required=true), CategoryCell, DateCell from cashflow. EndDateCell is recurring-specific (nullable, shows "Open").
- **Keyboard shortcuts:** `d` delete, `p` pause/resume, `e` edit payee, `c` edit category. No copy/paste (unlike cashflow).
- **Inactive section:** Collapsible, uses RecurringTable with `inactive` prop (disables cell editing, shows Resume instead of Pause).
- **Draft persistence:** sessionStorage keyed `recurring-draft-income`/`recurring-draft-expense`.
- **Due indicator:** Pulsing dot when `is_active && next_occurrence <= today`.
- **Variable amount:** Shows `~` prefix and lightning bolt icon.

### PDF Import (`src/lib/pdf-import/`, `src/components/pdf-import/`)

Pipeline: `PdfImportModal` → `parseStatement()` → `pdfToImages()` → `provider.stream()` → streaming review → bulk insert.

- **LLM-agnostic:** Supports Anthropic, OpenAI, Gemini, and custom (OpenAI-compatible) providers. No SDK dependencies — all providers use raw `fetch` + SSE parsing.
- **Provider system:** `src/lib/pdf-import/providers/` — each adapter implements `LLMProvider.stream()`. Shared SSE reader in `sse.ts`, shared error classifier and constants in `shared.ts`.
- **Settings keys:** `llm_provider`, `llm_api_key`, `llm_model`, `llm_base_url`. Auto-migrates from old `anthropic_*` keys on first load.
- **Default models:** Anthropic: Sonnet 4.6, OpenAI: GPT-4.1 Mini, Gemini: 2.5 Flash
- **Streaming:** Incremental JSON array parser (`stream-parser.ts`) emits each transaction as it completes. Drip queue (80ms) reveals them one-by-one in the modal.
- **Parallelization:** Pages batched (5 per batch), up to 3 batches run concurrently via `Promise.all` chunks.
- **Duplicate detection:** After parsing, queries existing DB transactions in the import's date range, builds fingerprint set (`date|amount|payee_normalized`), auto-deselects matches.
- **COEP constraint:** Cannot call LLM APIs directly from browser under COEP `require-corp`. Generic proxy in `vite.config.ts` routes `/api/llm/{provider}/*` to upstream APIs with streaming (piped, not buffered).
- **Error handling:** HTTP status codes classified per provider via data-driven mappings. No technical details leaked to user.

### Categories Page (`src/routes/categories.tsx`)

Two-column layout (Expense | Income side by side on desktop, stacked on mobile). Progressive disclosure design — no modals:
- Each column is dedicated to one type (Expense or Income), replacing the old collapsible group approach
- Parent categories default to collapsed; expandable to reveal subcategories
- Click-to-edit inline (replaces row with form), Esc cancels
- Color palette hidden behind color swatch, click to reveal
- Inline "Add category" at bottom of each column

### Zakat Calculator (`src/routes/zakat.tsx`, `src/components/zakat/zakat-utils.ts`)

Two-column desktop layout (form left, sticky breakdown right). Mobile: sticky bottom bar above nav with expandable breakdown.

- **Live calculation:** No "Calculate" button — `useMemo` computes `preview` on every input change, breakdown is always visible.
- **Calculation engine:** `zakat-utils.ts` — madhab-aware (Hanafi/Maliki/Shafi'i/Hanbali), supports simple + detailed modes.
- **Stocks:** Trading (100% zakatable) vs hold (per-share, investment %, 25% shortcut). Detailed mode: granular per-stock positions via `HoldPosition[]`.
- **Draft persistence:** sessionStorage (`zakat-draft`) with 400ms debounce. Restored on page load.
- **History:** Stored in `settings` table as JSON (key: `zakat_history`). Includes `inputs` for reload.
- **Save:** Creates expense transaction under `Donations > Zakat` category (auto-created if missing).
- **Mobile bottom bar:** `fixed bottom-14 z-30` — sits above MobileNav (`fixed bottom-0 z-40`).

## Key Conventions

- **Font:** TX-02 (OTF files in `public/fonts/`)
- **Colors:** CSS variables in `src/globals.css` using custom naming (`--color-accent`, `--color-surface`, `--color-text-muted`, etc.)
- **Formatting:** `formatCurrency()`, `formatDate()`, `getCurrentMonth()` from `src/lib/format.ts`
- **Toasts:** Custom ToastProvider context (`src/components/ui/Toast.tsx`) — use `useToast()` hook
- **Modals/Dialogs:** `<Modal />` wrapping HTML `<dialog>`, `<ConfirmDialog />` for confirm/cancel
- **UI Components** (`src/components/ui/`): Button (variants: primary/secondary/danger/ghost), Input, Select, Modal, ConfirmDialog, MonthPicker, MonthRangePicker, Toast
- **Icons:** Inline SVG components defined in component files (not using an icon library)
- **Path alias:** `@/*` maps to `./src/*`
- **Dev tools:** `AdminPanel` component (FAB gear icon, dev-only via `VITE_DEV_TOOLS` env var) — SQL console, table counts, seed categories, seed dummy data, clear data, factory reset
- **Draft persistence:** sessionStorage with debounced writes (ref guard to skip initial write on load, `JSON.stringify` to save, `removeItem` on reset). Used in cashflow inline-add and zakat calculator.
- **PWA updates:** `registerType: "prompt"` — `PwaUpdater` component (`src/components/PwaUpdater.tsx`) shows a refresh banner when a new SW is available. SW registration lives in PwaUpdater, not in `main.tsx`.

## Important Config (vite.config.ts)

- **COOP/COEP headers** required for OPFS: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
- **LLM proxy plugin:** Generic middleware routes `/api/llm/{provider}/*` to upstream APIs (Anthropic, OpenAI, Gemini, custom via `X-Target-URL` header). Required because COEP blocks direct browser→API calls. Handles OPTIONS locally, strips browser headers, streams response via `Readable.fromWeb().pipe()`.
- **Worker format:** ES modules
- **wa-sqlite** excluded from optimizeDeps (installed from `github:rhashimoto/wa-sqlite`, not npm)
- **PWA register type:** `prompt` (not `autoUpdate`) — update lifecycle managed by `PwaUpdater` component

## Schema (Tables)

`categories` (hierarchical, color/icon, is_income/is_system flags) | `transactions` (amount, type, category_id, date, payee, notes, recurring_id, status, group_name) | `recurring_transactions` (frequency, next_occurrence, mode, anchor_day, is_variable, exceptions — joined via `transactions.recurring_id`) | `tags` + `transaction_tags` (many-to-many) | `budgets` (category budgets by month) | `settings` (key-value store)
