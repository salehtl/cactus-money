# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.5.0] - 2026-03-13

### Added
- **Multi-occurrence recurring**: Weekly/daily/biweekly rules now generate all occurrences within a month (e.g. a weekly rule produces 4–5 transactions), not just one
- **Timezone-aware scheduling**: Replaced UTC-based date logic with `Intl.DateTimeFormat` timezone support (default: Asia/Dubai), configurable in Settings
- **Monthly projection summary**: Recurring page summary now shows projected monthly totals using `monthlyEquivalent()` conversion

### Changed
- **Inactive section redesign**: Split into separate Income/Expense sections with "Ended" (gray, strikethrough) and "Paused" (orange) status badges

### Fixed
- **Transactions showing wrong dates between midnight–4AM**: Timezone-aware `getToday()` fixes date boundary issues in UAE timezone
- **Resuming ended recurring rule respects cadence**: Resuming a rule now computes the next valid occurrence from the rule's frequency and anchor day, instead of naively using today's date

## [2.4.1] - 2026-03-11

### Fixed
- **Auto-export now actually triggers automatically**: The auto-export setting was saved but never acted on — data changes (transactions, categories, recurring) now trigger a debounced export to the linked directory when auto-export is enabled
- **Auto-export toggle takes effect immediately**: Toggling auto-export on/off in Settings now propagates instantly without requiring a page reload
- **Last export timestamp refreshes after background auto-export**: The "Last export" display in Settings now updates when an automatic export completes in the background
- **Backup export version corrected**: Exported JSON now correctly reports the current schema version (4) instead of hardcoded 3, ensuring import normalization runs correctly on older backups

## [2.4.0] - 2026-03-11

### Added
- **Recurring scope modal**: Editing Payee, Amount, or Date on a recurring transaction now shows a prompt — "Just this one" updates only the selected instance, "Update all future" syncs the rule template and all future planned/review instances
- **Recur column — attach recurrence**: Selecting a frequency on a one-time (standalone) transaction creates a new recurring rule and links the transaction as its first instance
- **Recur column — change frequency**: Changing the frequency on an existing recurring transaction updates the rule, recomputes the schedule, and regenerates future instances under the new frequency
- **Resume catches up missed occurrences**: Resuming a paused recurring rule now runs the scheduler to catch up any occurrences that were missed while paused
- `deleteFutureInstancesOfRule` and `updateFutureInstancesOfRule` DB query helpers for managing recurring instance lifecycle

### Fixed
- **Stop recurrence now purges future instances**: Stopping a recurrence (via Recur → None or Actions → Stop recurrence) now also deletes all future `planned` and `review` instances, not just deactivates the rule
- **Category edits on recurring cashflow rows propagate to rule and future instances**: Previously only updated the single instance
- Editing frequency or start/end date on the Recurring page now deletes stale future instances and regenerates them under the correct new schedule
- Editing Payee, Amount, or Category on the Recurring page now syncs all future planned/review instances automatically (no prompt needed on the Recurring page — changes are always authoritative)
- Deleting a recurring rule now triggers a cashflow refresh so transactions that lost their `recurring_id` link are reflected immediately
- `updateTransaction` now supports updating `recurring_id` (needed to link a transaction to a newly created rule)

## [2.3.3] - 2026-03-10

### Fixed
- Cashflow date cell: clicking prev/next month arrows in the calendar popup no longer immediately closes the popup (click was bubbling to the row handler which cleared editing state)
- Cashflow frequency cell: same click-propagation fix for the frequency dropdown
- Cashflow frequency cell: selecting "None" on a recurring transaction now correctly stops the recurrence (previously silently did nothing)

## [2.3.2] - 2026-03-10

### Fixed
- Cashflow bulk delete now correctly deletes all selected transactions (previously only the last one was deleted)
- Cashflow bulk actions bar is now unified across income and expense tables — selecting from both tables no longer shows two overlapping action bars
- Cashflow bulk actions: Category is hidden when income and expense transactions are mixed (categories are type-specific)
- Escape key now clears selection even when the header checkbox has focus (previously only worked with keyboard-driven selection)
- Bulk delete, status, and category changes now issue a single batched SQL query and emit one refresh event instead of N sequential operations

## [2.3.1] - 2026-03-10

### Fixed
- PDF import: LLM API errors now surface the actual upstream error message instead of generic fallback text
- PDF import: Gemini 400/403 errors no longer incorrectly shown as "Invalid API Key"
- PDF import: OpenAI 403 errors no longer incorrectly shown as "No API Credits" (can be quota, org restrictions, or model access)
- PDF import: plain-text error bodies from APIs are now shown to users (previously only JSON bodies were parsed)
- Vite dev proxy: cancelling a PDF import mid-stream no longer crashes the dev server
- Vite dev proxy: upstream fetch is now aborted immediately when the browser disconnects, preventing hung connections
- Vite dev proxy: added 120s server-side timeout to prevent indefinitely stalled upstream connections

## [2.3.0] - 2026-03-10

### Changed
- Cashflow and Recurring pages now use Linear-inspired table UX: click-to-edit per cell, keyboard navigation (arrows, j/k, Enter, Escape, Tab), multi-select (checkboxes, shift-click, Cmd+A), and bulk actions
- Cashflow page refactored from 920-line monolith into ~20 focused table components with shared infrastructure
- Recurring page refactored from 689-line monolith into ~160-line orchestrator using shared table components
- Table infrastructure (useTableState, useTableKeyboard, cell components) is now parameterizable and reusable across pages

### Added
- Recurring page: per-cell editing for payee, amount, frequency, category, start date, end date
- Recurring page: keyboard shortcuts (d=delete, p=pause/resume, e=edit payee, c=edit category)
- Recurring page: multi-select with bulk Pause/Resume, Category change, and Delete
- Recurring page: inline add row with draft persistence to sessionStorage
- EndDateCell component for nullable date fields (shows "Open", calendar + "Clear end date")
- FrequencyCell `required` prop to hide "None" option (used by recurring)

### Fixed
- CategoryCombo input not receiving focus when dropdown opens via autoOpen or button click

## [2.2.3] - 2026-03-10

### Fixed
- Recurring import failing with foreign key constraint errors
- PWA update banner dismiss now allows future update checks to resume
- Stale update cooldown no longer persists across component remounts
- Changelog hook no longer triggers redundant full-table DB scans on every settings change

## [2.2.2] - 2026-03-10

### Fixed
- Recurring transactions duplicating in cashflow: race condition in event emission and non-atomic insert

### Added
- Export Recurring button in settings (JSON export of recurring transactions)

## [2.2.1] - 2026-03-10

### Fixed
- PWA updater robustness: error handling, double-click guard, safe area spacing
- JSON import now round-trips anchor_day and is_variable for recurring transactions
- Snowball backup growth: pre-migration backup no longer nests previous backups
- `normalizeImportData` wired into JSON import (was dead code)
- `editStatus` type now includes "review" status for inline edit mode

### Changed
- Extract shared constants (BACKUP_TABLES, ANCHOR_DAY_FREQUENCIES) to reduce duplication
- Hoist StatusPill config to module-level constant, simplify variant logic
- Simplify reviewCount with loop instead of spread+flatMap+filter
- Clean up recurring scheduler in DbContext (flatten nested conditions, early returns)
- Simplify useCashflow auto-confirm and populateFutureMonth logic
- Inline trivial wrappers in recurring form and hooks
- Deduplicate field reset logic in cashflow inline-add row
- Updated PWA icons, OG image, and added twitter card

### Removed
- Dead `StatusPill.tsx` from cashflow/ (already extracted to ui/)
- Non-functional Review scroll button and unused firstReviewRef

## [2.2.0] - 2026-03-10

### Added
- Variable-amount recurring transactions with "review" status and cashflow banner notification
- Recurring page redesigned with separate Income/Expense groups and summary bar
- Anchor-day support for monthly/quarterly/yearly recurring (always lands on same day-of-month)
- Auto-generation of recurring transactions on app startup (catches up missed months)
- Pre-migration auto-backup stored in settings before schema upgrades
- Export/import compatibility for v2 backups (auto-derives anchor_day)

### Fixed
- Date drift bug: monthly recurring losing one day per iteration in UTC+ timezones
- Past recurring transactions now auto-set to "confirmed" instead of always "planned"
- Inline category creation from income recurring rules now correctly marks category as income

### Changed
- Schema version 3 → 4 (added anchor_day, is_variable columns to recurring_transactions)
- Export format version 2 → 3
- StatusPill extracted to shared component with three variants (planned/confirmed/review)
- Recurring scheduler unified into single processRecurringRules function (replaces processDue + autoPopulateFutureTransactions)

### Removed
- Dead `processDue()` code from useRecurring hook

## [2.1.2] - 2026-03-10

### Fixed
- PDF import showing "No Transactions Found" after streaming 100+ transactions — streamed transactions are now recovered when a batch fails mid-stream
- Future dates from LLM-parsed bank statements are now discarded (cleared to empty for user correction)

### Changed
- LLM response buffer limit raised from 1MB to 4MB to accommodate verbose models like GPT-4.1 Mini

## [2.1.1] - 2026-03-10

### Added
- Uncategorized filter toggle in PDF import review modal
- Portal-rendered category dropdown in review table (escapes overflow clipping)
- Model name shown in modal title during PDF import
- PWA update prompt — shows refresh banner when a new version is available
- Periodic SW update checks (every 15min) and on app foreground (with 5min cooldown)
- "Check for Updates" button in Settings
- Rate-limit docs link in RateLimitedView modal
- Rate-limit notices in file queue and streaming progress views
- Semver changelog policy in CLAUDE.md

### Changed
- Adaptive rate-limit backoff: exponential backoff with jitter (2s→4s→8s→16s, capped 30s) replaces fixed 2s delay
- Up to 4 attempts per batch before surfacing rate-limit error (was 2)
- 1s inter-batch delay smooths token consumption to avoid API bursts
- Privacy notice now provider-agnostic (was hardcoded to Anthropic)

### Fixed
- Partial rate-limit failure silently skipping batches in PDF import
- Streaming UX restored: transactions appear one-by-one during import instead of in bulk
- Select-all checkbox now scopes to active filter (file or uncategorized)
- Portal dropdown positioning: clamps to viewport edges and flips upward near bottom

## [2.1.0] - 2026-03-09

### Added
- Changelog with "What's New" viewer in Settings
- Multi-provider PDF import (Anthropic, OpenAI, Gemini, custom)

## [2.0.0] - 2026-02-15

### Added
- Zakat calculator with madhab-aware engine and stock support
- Two-column zakat layout with live breakdown and mobile sticky bar
- Privacy notice on PDF import modal
- Recurring transactions with frequency display
- Overview page with multi-month chart and pivot grid
