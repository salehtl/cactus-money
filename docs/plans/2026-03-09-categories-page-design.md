# Categories Page Design

## Summary

Move categories management from settings.tsx to a dedicated `/categories` route with two-column desktop layout and collapsed-by-default tree groups.

## Route & Navigation

- New file: `src/routes/categories.tsx`
- No sidebar/mobile nav entry — accessed via link button in Settings
- PageHeader with "Categories" title and back link to `/settings`

## Layout

- **Desktop (md+):** `grid-cols-2 gap-4` — Expense left, Income right
- **Mobile:** Single column, Expense above Income
- Each column in its own section card (`bg-surface rounded-xl border`)
- Column header shows type label + category count

## Collapsible Tree

- Parent categories default **collapsed** (changed from current default-expanded)
- Same chevron + expand/collapse behavior
- No top-level group accordion — each column is always visible
- Inline edit, inline add, color picker, delete confirm all unchanged

## Settings Page Changes

- Remove `CategoriesSection` and all category-related components/icons
- Replace with link button row (same style as "What's New" button)
- Shows icon + "Categories" label + count subtitle + chevron
- Navigates to `/categories` on click

## Components Moved

From `settings.tsx` to `categories.tsx`:
- `COLORS` constant
- `ChevronIcon`, `PencilIcon`, `TrashIcon`, `PlusIcon`
- `InlineCategoryForm`
- `CategoryRow`
- `CategoryGroup` (modified: no top-level accordion, just the content)
- `CategoriesSection` logic (becomes the page component)
- `ConfirmDialog` for delete (stays as import)
