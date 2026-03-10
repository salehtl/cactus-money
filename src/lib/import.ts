import type { DbClient } from "../db/client.ts";
import { normalizeImportData } from "./export.ts";

interface BackupData {
  version: number;
  categories: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  recurring_transactions: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  tags: Record<string, unknown>[];
}

interface RecurringBackupData {
  recurring_transactions: Record<string, unknown>[];
}

/** Import recurring transactions JSON (merge via upsert — existing rules are updated, new ones inserted). */
export async function importRecurringJSON(db: DbClient, jsonString: string): Promise<number> {
  const data: RecurringBackupData = JSON.parse(jsonString);

  if (!Array.isArray(data.recurring_transactions) || data.recurring_transactions.length === 0) {
    throw new Error("Invalid recurring backup — no recurring_transactions found");
  }

  // Resolve valid category_ids — null out any that don't exist in this DB
  const { rows: cats } = await db.exec<{ id: string }>("SELECT id FROM categories");
  const validCategoryIds = new Set(cats.map((r) => r.id));

  await db.exec("BEGIN TRANSACTION;");
  try {
    let count = 0;
    for (const rec of data.recurring_transactions) {
      const categoryId = rec.category_id && validCategoryIds.has(rec.category_id as string)
        ? rec.category_id
        : null;
      await db.exec(
        `INSERT INTO recurring_transactions (id, amount, type, category_id, payee, notes, frequency, custom_interval_days, start_date, end_date, next_occurrence, mode, is_active, anchor_day, is_variable, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           amount = excluded.amount, type = excluded.type, category_id = excluded.category_id,
           payee = excluded.payee, notes = excluded.notes, frequency = excluded.frequency,
           custom_interval_days = excluded.custom_interval_days, start_date = excluded.start_date,
           end_date = excluded.end_date, next_occurrence = excluded.next_occurrence,
           mode = excluded.mode, is_active = excluded.is_active, anchor_day = excluded.anchor_day,
           is_variable = excluded.is_variable, updated_at = datetime('now')`,
        [
          rec.id,
          rec.amount,
          rec.type,
          categoryId,
          rec.payee ?? "",
          rec.notes ?? "",
          rec.frequency,
          rec.custom_interval_days ?? null,
          rec.start_date,
          rec.end_date ?? null,
          rec.next_occurrence,
          rec.mode ?? "reminder",
          rec.is_active ?? 1,
          rec.anchor_day ?? null,
          rec.is_variable ?? 0,
          rec.created_at ?? new Date().toISOString(),
          rec.updated_at ?? new Date().toISOString(),
        ]
      );
      count++;
    }
    await db.exec("COMMIT;");
    return count;
  } catch (e) {
    await db.exec("ROLLBACK;");
    throw e;
  }
}

export async function importJSON(db: DbClient, jsonString: string): Promise<void> {
  const data: BackupData = normalizeImportData(JSON.parse(jsonString));

  if (!data.version || !data.categories || !data.transactions) {
    throw new Error("Invalid backup file format");
  }

  await db.exec("BEGIN TRANSACTION;");
  try {
    // Clear existing data
    await db.exec("DELETE FROM transaction_tags;");
    await db.exec("DELETE FROM transactions;");
    await db.exec("DELETE FROM recurring_transactions;");
    await db.exec("DELETE FROM tags;");
    await db.exec("DELETE FROM categories;");
    await db.exec("DELETE FROM settings;");

    // Import categories
    for (const cat of data.categories) {
      await db.exec(
        `INSERT INTO categories (id, name, parent_id, color, icon, sort_order, is_income, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cat.id,
          cat.name,
          cat.parent_id ?? null,
          cat.color,
          cat.icon ?? "",
          cat.sort_order ?? 0,
          cat.is_income ?? 0,
          cat.is_system ?? 0,
          cat.created_at ?? new Date().toISOString(),
          cat.updated_at ?? new Date().toISOString(),
        ]
      );
    }

    // Import transactions
    for (const txn of data.transactions) {
      await db.exec(
        `INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txn.id,
          txn.amount,
          txn.type,
          txn.category_id ?? null,
          txn.date,
          txn.payee ?? "",
          txn.notes ?? "",
          txn.recurring_id ?? null,
          txn.status ?? "confirmed", // v1 backups won't have status
          txn.group_name ?? "",      // v1 backups won't have group_name
          txn.created_at ?? new Date().toISOString(),
          txn.updated_at ?? new Date().toISOString(),
        ]
      );
    }

    // Import recurring
    for (const rec of data.recurring_transactions ?? []) {
      await db.exec(
        `INSERT INTO recurring_transactions (id, amount, type, category_id, payee, notes, frequency, custom_interval_days, start_date, end_date, next_occurrence, mode, is_active, anchor_day, is_variable, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rec.id,
          rec.amount,
          rec.type,
          rec.category_id ?? null,
          rec.payee ?? "",
          rec.notes ?? "",
          rec.frequency,
          rec.custom_interval_days ?? null,
          rec.start_date,
          rec.end_date ?? null,
          rec.next_occurrence,
          rec.mode ?? "reminder",
          rec.is_active ?? 1,
          rec.anchor_day ?? null,
          rec.is_variable ?? 0,
          rec.created_at ?? new Date().toISOString(),
          rec.updated_at ?? new Date().toISOString(),
        ]
      );
    }

    // Import tags
    for (const tag of data.tags ?? []) {
      await db.exec(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
        [tag.id, tag.name, tag.color ?? "#64748b", tag.created_at ?? new Date().toISOString()]
      );
    }

    // Import settings
    for (const setting of data.settings ?? []) {
      await db.exec(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
        [setting.key, setting.value, setting.value]
      );
    }

    await db.exec("COMMIT;");
  } catch (e) {
    await db.exec("ROLLBACK;");
    throw e;
  }
}
