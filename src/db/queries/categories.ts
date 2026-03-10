import type { DbClient } from "../client.ts";
import type { Category } from "../../types/database.ts";
import { SET_UPDATED_AT } from "../schema.ts";

export async function getCategories(db: DbClient): Promise<Category[]> {
  const { rows } = await db.exec<Category>(
    "SELECT * FROM categories ORDER BY is_income, sort_order, name"
  );
  return rows;
}

export async function createCategory(
  db: DbClient,
  cat: {
    id: string;
    name: string;
    parent_id?: string | null;
    color: string;
    icon?: string;
    sort_order?: number;
    is_income: boolean;
  }
): Promise<void> {
  await db.exec(
    `INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_income)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      cat.id,
      cat.name,
      cat.parent_id ?? null,
      cat.color,
      cat.icon ?? "",
      cat.sort_order ?? 0,
      cat.is_income ? 1 : 0,
    ]
  );
}

export async function updateCategory(
  db: DbClient,
  id: string,
  updates: {
    name?: string;
    parent_id?: string | null;
    color?: string;
    icon?: string;
    sort_order?: number;
    is_income?: boolean;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.parent_id !== undefined) {
    sets.push("parent_id = ?");
    params.push(updates.parent_id);
  }
  if (updates.color !== undefined) {
    sets.push("color = ?");
    params.push(updates.color);
  }
  if (updates.icon !== undefined) {
    sets.push("icon = ?");
    params.push(updates.icon);
  }
  if (updates.sort_order !== undefined) {
    sets.push("sort_order = ?");
    params.push(updates.sort_order);
  }
  if (updates.is_income !== undefined) {
    sets.push("is_income = ?");
    params.push(updates.is_income ? 1 : 0);
  }

  if (sets.length === 0) return;
  sets.push(SET_UPDATED_AT);
  params.push(id);

  await db.exec(
    `UPDATE categories SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deleteCategory(
  db: DbClient,
  id: string
): Promise<void> {
  await db.exec("DELETE FROM categories WHERE id = ?", [id]);
}
