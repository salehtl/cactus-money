# Changelog Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users discover what's new via a changelog modal in Settings, with a dot badge notification on the Settings icon when there's an unseen version.

**Architecture:** `CHANGELOG.md` in repo root imported as raw string at build time via Vite `?raw`. A small parser extracts structured entries. A `useChangelog()` hook reads `lastSeenVersion` from the settings table to drive a dot badge on the Settings nav icon. The changelog modal uses the existing `<Modal>` component with collapsible version sections.

**Tech Stack:** React 19, Vite `?raw` import, wa-sqlite settings table, existing Modal/event bus

---

### Task 1: Create CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

**Step 1: Create the changelog file**

```markdown
# Changelog

## [2.1.0] - 2026-03-09

- Added changelog with "What's New" viewer in Settings
- Multi-provider PDF import (Anthropic, OpenAI, Gemini, custom)

## [2.0.0] - 2026-02-15

- Zakat calculator with madhab-aware engine and stock support
- Two-column zakat layout with live breakdown and mobile sticky bar
- Privacy notice on PDF import modal
- Recurring transactions with frequency display
- Overview page with multi-month chart and pivot grid
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "feat: add CHANGELOG.md with initial release history"
```

---

### Task 2: Create changelog parser

**Files:**
- Create: `src/lib/changelog.ts`

**Step 1: Create the parser module**

```typescript
import changelogRaw from "../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const versionRegex = /^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})/;

  let current: ChangelogEntry | null = null;

  for (const line of raw.split("\n")) {
    const match = line.match(versionRegex);
    if (match) {
      if (current) entries.push(current);
      current = { version: match[1], date: match[2], items: [] };
    } else if (current && line.startsWith("- ")) {
      current.items.push(line.slice(2).trim());
    }
  }
  if (current) entries.push(current);

  return entries;
}

export const changelogEntries = parseChangelog(changelogRaw);
export const latestVersion = changelogEntries[0]?.version ?? "0.0.0";
```

**Step 2: Add TypeScript declaration for `?raw` imports**

Check if `src/vite-env.d.ts` already has a `*.md?raw` declaration. If not, add:

```typescript
declare module "*.md?raw" {
  const content: string;
  export default content;
}
```

Note: Vite's `client.d.ts` already handles `?raw` for all file types, so this may not be needed. Only add if TypeScript complains.

**Step 3: Verify build works**

Run: `bun run build`
Expected: No TypeScript errors, builds successfully.

**Step 4: Commit**

```bash
git add src/lib/changelog.ts
git commit -m "feat: add changelog parser with Vite raw import"
```

---

### Task 3: Create useChangelog hook

**Files:**
- Create: `src/hooks/useChangelog.ts`

**Dependencies:** Task 2 (parser), existing `src/db/queries/settings.ts`, `src/lib/db-events.ts`

**Step 1: Create the hook**

```typescript
import { useCallback, useEffect, useState } from "react";
import { useDb } from "@/context/DbContext";
import { getSetting, setSetting } from "@/db/queries/settings";
import { emitDbEvent, onDbEvent } from "@/lib/db-events";
import { changelogEntries, latestVersion } from "@/lib/changelog";
import type { ChangelogEntry } from "@/lib/changelog";

const SETTINGS_KEY = "last_seen_version";

export function useChangelog() {
  const { db } = useDb();
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting(db, SETTINGS_KEY).then((val) => {
      if (!cancelled) {
        setLastSeen(val);
        setLoaded(true);
      }
    });
    const unsub = onDbEvent("settings-changed", () => {
      getSetting(db, SETTINGS_KEY).then((val) => {
        if (!cancelled) setLastSeen(val);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [db]);

  const hasNew = loaded && lastSeen !== latestVersion;

  const markSeen = useCallback(async () => {
    await setSetting(db, SETTINGS_KEY, latestVersion);
    setLastSeen(latestVersion);
    emitDbEvent("settings-changed");
  }, [db]);

  return {
    entries: changelogEntries as ChangelogEntry[],
    latestVersion,
    hasNew,
    markSeen,
  };
}
```

**Step 2: Verify build works**

Run: `bun run build`
Expected: Builds successfully.

**Step 3: Commit**

```bash
git add src/hooks/useChangelog.ts
git commit -m "feat: add useChangelog hook with version tracking"
```

---

### Task 4: Create ChangelogModal component

**Files:**
- Create: `src/components/changelog/ChangelogModal.tsx`

**Dependencies:** Task 2 (ChangelogEntry type), existing `<Modal>` component

**Step 1: Create the modal component**

```tsx
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { ChangelogEntry } from "@/lib/changelog";

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
}

export function ChangelogModal({ open, onClose, entries }: ChangelogModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Latest version expanded by default
    return new Set(entries[0] ? [entries[0].version] : []);
  });

  const toggle = (version: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="What's New">
      <div className="space-y-2">
        {entries.map((entry) => {
          const isOpen = expanded.has(entry.version);
          return (
            <div key={entry.version} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(entry.version)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-alt transition-colors cursor-pointer"
              >
                <span className="text-sm font-semibold">v{entry.version}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {formatDate(entry.date)}
                  </span>
                  <ChevronIcon open={isOpen} />
                </span>
              </button>
              {isOpen && (
                <ul className="px-3 pb-3 space-y-1">
                  {entry.items.map((item, i) => (
                    <li key={i} className="text-sm text-text-muted flex gap-2">
                      <span className="text-text-light mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
```

**Step 2: Verify build works**

Run: `bun run build`
Expected: Builds successfully.

**Step 3: Commit**

```bash
git add src/components/changelog/ChangelogModal.tsx
git commit -m "feat: add ChangelogModal with collapsible version sections"
```

---

### Task 5: Add dot badge to Sidebar and MobileNav

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Dependencies:** Task 3 (useChangelog hook)

**Step 1: Add dot badge to SidebarLink and MobileNavItem**

Import `useChangelog` at the top of the file. Pass `hasNew` to the Settings nav items. Add a small dot badge when `hasNew` is true and the item is for Settings.

Changes to make:

1. Import `useChangelog` from `@/hooks/useChangelog`.
2. In `Sidebar` component, call `const { hasNew } = useChangelog()` and pass `showBadge={item.to === "/settings" && hasNew}` to `SidebarLink`.
3. In `SidebarLink`, accept `showBadge?: boolean` prop. Wrap the `<Icon>` in a `relative` container. When `showBadge`, render a `<span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />` inside that container.
4. Same pattern for `MobileNav` → `MobileNavItem`.

**Step 2: Verify visually**

Run: `bun run dev`
Expected: Dot appears on Settings icon (since `lastSeenVersion` is null initially).

**Step 3: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add dot badge on Settings icon for unseen changelog"
```

---

### Task 6: Wire up changelog modal in Settings page

**Files:**
- Modify: `src/routes/settings.tsx`

**Dependencies:** Task 3 (useChangelog), Task 4 (ChangelogModal)

**Step 1: Add state and imports**

At the top of the settings route component:
- Import `useChangelog` from `@/hooks/useChangelog`
- Import `ChangelogModal` from `@/components/changelog/ChangelogModal`
- Add `const [showChangelog, setShowChangelog] = useState(false)`
- Call `const { entries, latestVersion, markSeen } = useChangelog()`

**Step 2: Replace hardcoded version and add "What's New" button**

In the About section (~line 236-244), change:
- `<p>Cactus Money v2.0.0</p>` → `<p>Cactus Money v{latestVersion}</p>`
- Add a "What's New" button after the version line:

```tsx
<button
  onClick={() => {
    setShowChangelog(true);
    markSeen();
  }}
  className="text-xs text-accent hover:underline cursor-pointer"
>
  What's New
</button>
```

**Step 3: Add ChangelogModal render**

Add before the closing fragment of the component (near the other modals):

```tsx
<ChangelogModal
  open={showChangelog}
  onClose={() => setShowChangelog(false)}
  entries={entries}
/>
```

**Step 4: Verify end-to-end**

Run: `bun run dev`
1. Open Settings → About shows dynamic version + "What's New" link
2. Click "What's New" → modal opens with changelog entries
3. Close modal → dot badge on Settings icon disappears
4. Refresh → no dot badge (version is now marked as seen)

**Step 5: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat: wire changelog modal in Settings with dynamic version"
```

---

### Task 7: Final build verification

**Step 1: Production build**

Run: `bun run build`
Expected: Clean build, no errors.

**Step 2: Preview**

Run: `bun run preview`
Expected: App loads, Settings shows correct version, What's New modal works, dot badge appears/disappears correctly.

**Step 3: Squash commits (optional)**

If desired, squash the 6 feature commits into one:

```bash
git rebase -i HEAD~6
```

Pick the first, squash the rest, with message: `feat: add changelog with What's New modal and version notification badge`
