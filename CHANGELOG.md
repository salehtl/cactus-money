# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
