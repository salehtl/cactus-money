# Changelog Feature Design

## Summary

Add a maintainable changelog system: author in `CHANGELOG.md`, parse at build time, surface to users via a modal in Settings with a dot badge notification on the Settings icon when there's a new version.

## Data & Parsing

- **Source:** `CHANGELOG.md` in repo root. Format: `## [version] - YYYY-MM-DD` headings followed by `- item` bullet lines. Plain text, no category subheadings.
- **Import:** Vite `?raw` suffix imports the file as a string at build time.
- **Parser:** `src/lib/changelog.ts` — splits by version headings, returns `ChangelogEntry[]` (`{ version, date, items: string[] }`).
- **Version:** Latest version derived from `entries[0].version`, replaces hardcoded "v2.0.0" in Settings.

## Version Tracking & Notification

- `lastSeenVersion` stored in `settings` table (existing key-value store).
- On app load, compare latest changelog version against `lastSeenVersion`.
- If different or missing: show dot badge on Settings icon in Sidebar and MobileNav.
- Opening the "What's New" modal updates `lastSeenVersion` — dot disappears.
- Reactivity via existing `settings-changed` event bus.

## UI

- **Dot badge:** `w-2 h-2 rounded-full bg-accent`, absolute-positioned on Settings nav icon.
- **"What's New" button:** In Settings About section, next to version display. Opens Modal.
- **Changelog Modal:** Uses existing `<Modal>`. Collapsible version groups — latest expanded, older collapsed. Each shows version + date header with bullet list body.
- **No new route** — modal only.

## Hook: `useChangelog()`

```
Returns: { entries: ChangelogEntry[], hasNew: boolean, markSeen: () => void }
```

- Parses changelog once (module-level cache).
- Reads `lastSeenVersion` from settings on mount.
- `hasNew` = latest version !== lastSeenVersion.
- `markSeen()` writes lastSeenVersion to settings, emits `settings-changed`.

## Approach

- Zero dependencies — custom parser for controlled markdown format.
- Vite `?raw` import, no build plugin needed.
- Existing UI components (Modal, settings table, event bus) reused throughout.
