import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../../test/db-helpers";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./categories";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe("getCategories", () => {
  it("returns empty array when no categories exist", async () => {
    const rows = await getCategories(db as any);
    expect(rows).toEqual([]);
  });
});

describe("createCategory", () => {
  it("creates and retrieves a category", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: false,
    });

    const rows = await getCategories(db as any);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: 0,
      parent_id: null,
      sort_order: 0,
      icon: "",
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
      name: "Groceries",
      color: "#16a34a",
      is_income: false,
      parent_id: "parent-1",
    });

    const rows = await getCategories(db as any);
    const child = rows.find((r) => r.id === "child-1");
    expect(child).toBeDefined();
    expect(child!.parent_id).toBe("parent-1");
  });
});

describe("updateCategory", () => {
  it("updates a category name and color", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: false,
    });

    await updateCategory(db as any, "cat-1", {
      name: "Food & Groceries",
      color: "#ef4444",
    });

    const rows = await getCategories(db as any);
    expect(rows[0]).toMatchObject({
      id: "cat-1",
      name: "Food & Groceries",
      color: "#ef4444",
    });
  });
});

describe("deleteCategory", () => {
  it("deletes a category", async () => {
    await createCategory(db as any, {
      id: "cat-1",
      name: "Groceries",
      color: "#22c55e",
      is_income: false,
    });

    await deleteCategory(db as any, "cat-1");

    const rows = await getCategories(db as any);
    expect(rows).toHaveLength(0);
  });
});

describe("sort order", () => {
  it("sorts by is_income first, then sort_order, then name", async () => {
    // Expense categories (is_income=0) should come first
    await createCategory(db as any, {
      id: "exp-b",
      name: "Beta Expense",
      color: "#000",
      is_income: false,
      sort_order: 2,
    });
    await createCategory(db as any, {
      id: "exp-a",
      name: "Alpha Expense",
      color: "#000",
      is_income: false,
      sort_order: 1,
    });
    // Two expense cats with same sort_order — should sort by name
    await createCategory(db as any, {
      id: "exp-d",
      name: "Delta Expense",
      color: "#000",
      is_income: false,
      sort_order: 2,
    });
    // Income categories (is_income=1) should come after
    await createCategory(db as any, {
      id: "inc-a",
      name: "Salary",
      color: "#000",
      is_income: true,
      sort_order: 0,
    });

    const rows = await getCategories(db as any);
    const ids = rows.map((r) => r.id);

    // Expense (is_income=0) before income (is_income=1)
    // Within expense: sort_order 1 (exp-a) < sort_order 2 (exp-b, exp-d by name)
    expect(ids).toEqual(["exp-a", "exp-b", "exp-d", "inc-a"]);
  });
});
