# Test Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up Vitest with three test tiers (pure logic, database queries, React components) and write starter tests for each.

**Architecture:** Vitest extends the existing Vite config. Tests are colocated with source. An in-memory SQLite (better-sqlite3) mimics the DbClient interface for DB tests. A `renderWithProviders` helper wraps components with all required contexts.

**Tech Stack:** Vitest, happy-dom, @testing-library/react, @testing-library/user-event, better-sqlite3

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install vitest and testing dependencies**

Run:
```bash
bun add -d vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom happy-dom better-sqlite3 @types/better-sqlite3
```

**Step 2: Add test scripts to package.json**

Add to the `"scripts"` section:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "Add vitest and testing dependencies"
```

---

### Task 2: Vitest Configuration

**Files:**
- Create: `vitest.config.ts`
- Modify: `tsconfig.json` (add `vitest/globals` types)

**Step 1: Create vitest.config.ts**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    css: false,
  },
});
```

Note: We use a separate `vitest.config.ts` instead of extending `vite.config.ts` because the vite config has server middleware plugins (llmProxyPlugin, COOP/COEP headers) and worker configs that aren't relevant for testing and could cause issues.

**Step 2: Add vitest globals to tsconfig.json**

Add `"vitest/globals"` to `compilerOptions.types`:
```json
{
  "compilerOptions": {
    "types": ["vitest/globals"],
    ...existing
  }
}
```

**Step 3: Commit**

```bash
git add vitest.config.ts tsconfig.json
git commit -m "Add vitest configuration"
```

---

### Task 3: Test Setup File

**Files:**
- Create: `src/test/setup.ts`

**Step 1: Create the global setup file**

```ts
import "@testing-library/jest-dom/vitest";
```

That's it — this registers the jest-dom matchers (`.toBeInTheDocument()`, `.toHaveTextContent()`, etc.) globally for all tests. happy-dom is configured in vitest.config.ts.

**Step 2: Verify setup by running vitest**

Run:
```bash
bun run test
```

Expected: "No test files found" (no tests yet, but no config errors).

**Step 3: Commit**

```bash
git add src/test/setup.ts
git commit -m "Add vitest global setup with jest-dom matchers"
```

---

### Task 4: Tier 1 — Pure Logic Tests (format.ts)

**Files:**
- Create: `src/lib/format.test.ts`

**Step 1: Write tests for format.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatMonth,
  getCurrentMonth,
  getPreviousMonth,
  getNextMonth,
  getToday,
} from "./format";

describe("formatCurrency", () => {
  it("formats positive amounts with AED", () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain("1,234.56");
    expect(result).toContain("AED");
  });

  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0.00");
  });

  it("formats small decimals with two places", () => {
    const result = formatCurrency(5.1);
    expect(result).toContain("5.10");
  });
});

describe("formatMonth", () => {
  it("formats YYYY-MM to full month and year", () => {
    const result = formatMonth("2026-01");
    expect(result).toContain("January");
    expect(result).toContain("2026");
  });

  it("handles December", () => {
    const result = formatMonth("2025-12");
    expect(result).toContain("December");
    expect(result).toContain("2025");
  });
});

describe("getCurrentMonth", () => {
  it("returns YYYY-MM format", () => {
    const result = getCurrentMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("getPreviousMonth", () => {
  it("goes back one month", () => {
    expect(getPreviousMonth("2026-03")).toBe("2026-02");
  });

  it("wraps around year boundary", () => {
    expect(getPreviousMonth("2026-01")).toBe("2025-12");
  });
});

describe("getNextMonth", () => {
  it("goes forward one month", () => {
    expect(getNextMonth("2026-03")).toBe("2026-04");
  });

  it("wraps around year boundary", () => {
    expect(getNextMonth("2025-12")).toBe("2026-01");
  });
});

describe("getToday", () => {
  it("returns YYYY-MM-DD format", () => {
    const result = getToday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

**Step 2: Run tests**

Run:
```bash
bun run test
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add src/lib/format.test.ts
git commit -m "Add format utility tests"
```

---

### Task 5: Tier 1 — Pure Logic Tests (stream-parser.ts)

**Files:**
- Create: `src/lib/pdf-import/stream-parser.test.ts`

**Step 1: Write tests for extractStreamedObjects**

```ts
import { describe, it, expect, vi } from "vitest";
import { extractStreamedObjects } from "./stream-parser";

describe("extractStreamedObjects", () => {
  it("extracts a single complete object from a JSON array", () => {
    const objects: unknown[] = [];
    const offset = extractStreamedObjects(
      '[{"name":"Alice","amount":100}]',
      0,
      (obj) => objects.push(obj),
    );
    expect(objects).toEqual([{ name: "Alice", amount: 100 }]);
    expect(offset).toBeGreaterThan(0);
  });

  it("extracts multiple objects", () => {
    const objects: unknown[] = [];
    extractStreamedObjects(
      '[{"a":1},{"b":2},{"c":3}]',
      0,
      (obj) => objects.push(obj),
    );
    expect(objects).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("returns 0 when no opening bracket found", () => {
    const objects: unknown[] = [];
    const offset = extractStreamedObjects("no json here", 0, (obj) => objects.push(obj));
    expect(offset).toBe(0);
    expect(objects).toEqual([]);
  });

  it("stops at incomplete object and returns offset for resumption", () => {
    const objects: unknown[] = [];
    const text = '[{"a":1},{"b":2';
    const offset = extractStreamedObjects(text, 0, (obj) => objects.push(obj));
    expect(objects).toEqual([{ a: 1 }]);
    // Offset should point to the start of the incomplete object
    expect(offset).toBeLessThan(text.length);
  });

  it("resumes from a previous offset", () => {
    const objects: unknown[] = [];
    const chunk1 = '[{"a":1},{"b":';
    const offset1 = extractStreamedObjects(chunk1, 0, (obj) => objects.push(obj));
    expect(objects).toEqual([{ a: 1 }]);

    // Simulate more data arriving
    const chunk2 = chunk1 + '2}]';
    extractStreamedObjects(chunk2, offset1, (obj) => objects.push(obj));
    expect(objects).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles nested braces inside strings", () => {
    const objects: unknown[] = [];
    extractStreamedObjects(
      '[{"note":"has {braces} inside"}]',
      0,
      (obj) => objects.push(obj),
    );
    expect(objects).toEqual([{ note: "has {braces} inside" }]);
  });

  it("handles escaped quotes in strings", () => {
    const objects: unknown[] = [];
    extractStreamedObjects(
      '[{"note":"says \\"hello\\""}]',
      0,
      (obj) => objects.push(obj),
    );
    expect(objects).toEqual([{ note: 'says "hello"' }]);
  });

  it("skips malformed objects gracefully", () => {
    const objects: unknown[] = [];
    extractStreamedObjects(
      '[{invalid},{"a":1}]',
      0,
      (obj) => objects.push(obj),
    );
    expect(objects).toEqual([{ a: 1 }]);
  });

  it("handles empty array", () => {
    const objects: unknown[] = [];
    extractStreamedObjects("[]", 0, (obj) => objects.push(obj));
    expect(objects).toEqual([]);
  });
});
```

**Step 2: Run tests**

Run:
```bash
bun run test
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add src/lib/pdf-import/stream-parser.test.ts
git commit -m "Add stream parser tests"
```

---

### Task 6: Tier 1 — Pure Logic Tests (db-events.ts)

**Files:**
- Create: `src/lib/db-events.test.ts`

**Step 1: Write tests for the event bus**

```ts
import { describe, it, expect, vi } from "vitest";
import { emitDbEvent, onDbEvent } from "./db-events";

describe("db-events", () => {
  it("calls handler when matching event is emitted", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("transactions-changed", handler);
    emitDbEvent("transactions-changed");
    expect(handler).toHaveBeenCalledOnce();
    unsub();
  });

  it("does not call handler for different event type", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("transactions-changed", handler);
    emitDbEvent("categories-changed");
    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribes correctly", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("settings-changed", handler);
    unsub();
    emitDbEvent("settings-changed");
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple handlers for same event", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = onDbEvent("tags-changed", h1);
    const unsub2 = onDbEvent("tags-changed", h2);
    emitDbEvent("tags-changed");
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    unsub1();
    unsub2();
  });
});
```

**Step 2: Run tests**

Run:
```bash
bun run test
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add src/lib/db-events.test.ts
git commit -m "Add db-events bus tests"
```

---

### Task 7: Tier 2 — Database Test Helper

**Files:**
- Create: `src/test/db-helpers.ts`

**Step 1: Create the in-memory DB factory**

Read `src/db/schema.ts` to understand the full DDL and migrations. The helper must:
1. Create an in-memory better-sqlite3 database
2. Enable foreign keys (`PRAGMA foreign_keys = ON`)
3. Run `CREATE_TABLES` DDL
4. Run all `MIGRATIONS` in order
5. Set `PRAGMA user_version` to `SCHEMA_VERSION`
6. Return an object matching the `DbClient.exec<T>()` interface

```ts
import Database from "better-sqlite3";
import { CREATE_TABLES, MIGRATIONS, SCHEMA_VERSION } from "../db/schema";

export interface TestDb {
  exec: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; changes: number }>;
  close: () => void;
}

export function createTestDb(): TestDb {
  const raw = new Database(":memory:");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  // Run base schema
  raw.exec(CREATE_TABLES);

  // Run migrations
  const versions = Object.keys(MIGRATIONS)
    .map(Number)
    .sort((a, b) => a - b);
  for (const v of versions) {
    raw.exec(MIGRATIONS[v]!);
  }
  raw.pragma(`user_version = ${SCHEMA_VERSION}`);

  return {
    exec: async <T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; changes: number }> => {
      const stmt = raw.prepare(sql);
      if (stmt.reader) {
        const rows = (params ? stmt.all(...params) : stmt.all()) as T[];
        return { rows, changes: 0 };
      } else {
        const result = params ? stmt.run(...params) : stmt.run();
        return { rows: [] as T[], changes: result.changes };
      }
    },
    close: () => raw.close(),
  };
}
```

**Step 2: Verify it compiles**

Run:
```bash
bunx vitest run --passWithNoTests
```

Expected: Exits cleanly with no errors.

**Step 3: Commit**

```bash
git add src/test/db-helpers.ts
git commit -m "Add in-memory SQLite test helper for DB tests"
```

---

### Task 8: Tier 2 — Database Query Tests (categories)

**Files:**
- Create: `src/db/queries/categories.test.ts`

**Step 1: Write tests for category CRUD**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../../test/db-helpers";
import { getCategories, createCategory, updateCategory, deleteCategory } from "./categories";

describe("categories queries", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty array when no categories exist", async () => {
    const cats = await getCategories(db as any);
    expect(cats).toEqual([]);
  });

  it("creates and retrieves a category", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: false,
    });

    const cats = await getCategories(db as any);
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: 0,
    });
  });

  it("creates a child category with parent_id", async () => {
    await createCategory(db as any, {
      id: "parent-1",
      name: "Food",
      color: "#22c55e",
      is_income: false,
    });
    await createCategory(db as any, {
      id: "child-1",
      name: "Restaurants",
      parent_id: "parent-1",
      color: "#ef4444",
      is_income: false,
    });

    const cats = await getCategories(db as any);
    const child = cats.find((c) => c.id === "child-1");
    expect(child?.parent_id).toBe("parent-1");
  });

  it("updates a category", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Old Name",
      color: "#000",
      is_income: false,
    });

    await updateCategory(db as any, "cat-1", { name: "New Name", color: "#fff" });

    const cats = await getCategories(db as any);
    expect(cats[0]).toMatchObject({ name: "New Name", color: "#fff" });
  });

  it("deletes a category", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Temp",
      color: "#000",
      is_income: false,
    });

    await deleteCategory(db as any, "cat-1");

    const cats = await getCategories(db as any);
    expect(cats).toHaveLength(0);
  });

  it("sorts by is_income then sort_order then name", async () => {
    await createCategory(db as any, { id: "b", name: "B Expense", color: "#000", is_income: false, sort_order: 2 });
    await createCategory(db as any, { id: "a", name: "A Expense", color: "#000", is_income: false, sort_order: 1 });
    await createCategory(db as any, { id: "c", name: "C Income", color: "#000", is_income: true, sort_order: 1 });

    const cats = await getCategories(db as any);
    expect(cats.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
```

Note: We use `db as any` to satisfy the `DbClient` type since our `TestDb` matches the runtime interface but not the class type. This is the pragmatic approach — an alternative would be extracting a `DbExec` interface from `DbClient`, but that's a separate refactor.

**Step 2: Run tests**

Run:
```bash
bun run test
```

Expected: All tests PASS. If `updateCategory` or `deleteCategory` have different signatures, adjust the test to match the actual function signatures — read the full file first.

**Step 3: Commit**

```bash
git add src/db/queries/categories.test.ts
git commit -m "Add category query tests against in-memory SQLite"
```

---

### Task 9: Tier 3 — Component Test Helper

**Files:**
- Create: `src/test/render-helpers.tsx`

**Step 1: Create renderWithProviders**

Read the following files first to understand what providers are needed:
- `src/context/DbContext.tsx` — DbProvider shape and useDb hook
- `src/components/ui/Toast.tsx` — ToastProvider
- `src/__root.tsx` or `src/routes/__root.tsx` — what providers the root layout wraps

Then create the helper:

```tsx
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement } from "react";
import { ToastProvider } from "../components/ui/Toast";

// For component tests that don't need DB, provide a mock
const mockDb = {
  exec: async () => ({ rows: [], changes: 0 }),
  waitReady: async () => "memory",
  storageType: "memory",
};

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {children}
    </ToastProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export { mockDb };
```

Note: DbContext requires a `DbClient` instance. For component tests that need DB, they should create a `TestDb` and pass it via context. For most component unit tests, the `mockDb` is sufficient. Adapt this based on the actual `DbContext` provider shape after reading the source.

**Step 2: Commit**

```bash
git add src/test/render-helpers.tsx
git commit -m "Add component test render helper with providers"
```

---

### Task 10: Tier 3 — Component Unit Test (StatusPill)

**Files:**
- Create: Find StatusPill location first (likely `src/components/cashflow/StatusPill.tsx` or `src/components/ui/StatusPill.tsx`), then create `StatusPill.test.tsx` next to it.

**Step 1: Read the StatusPill component to understand its props and behavior**

It should be a simple toggle between "planned" and "confirmed" status.

**Step 2: Write tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders planned status", () => {
    render(<StatusPill status="planned" onChange={() => {}} />);
    expect(screen.getByText(/planned/i)).toBeInTheDocument();
  });

  it("renders confirmed status", () => {
    render(<StatusPill status="confirmed" onChange={() => {}} />);
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it("calls onChange when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusPill status="planned" onChange={onChange} />);

    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("respects disabled prop", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusPill status="planned" onChange={onChange} disabled />);

    await user.click(screen.getByRole("button"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

Adjust props and assertions based on the actual component API after reading it.

**Step 3: Run tests**

Run:
```bash
bun run test
```

Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/components/**/StatusPill.test.tsx
git commit -m "Add StatusPill component tests"
```

---

### Task 11: Verify Full Suite and Final Commit

**Step 1: Run the complete test suite**

Run:
```bash
bun run test
```

Expected: All tests pass across all three tiers.

**Step 2: Run build to ensure nothing is broken**

Run:
```bash
bun run build
```

Expected: Clean build with no errors. Test files should not be included in the build output (vitest.config.ts is separate from vite.config.ts).

**Step 3: Final commit if any loose changes remain**

```bash
git status
# If anything unstaged, add and commit
```
