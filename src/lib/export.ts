import type { DbClient } from "../db/client.ts";

export async function exportJSON(db: DbClient): Promise<string> {
  const [categories, transactions, recurring, settings, tags] =
    await Promise.all([
      db.exec("SELECT * FROM categories"),
      db.exec("SELECT * FROM transactions"),
      db.exec("SELECT * FROM recurring_transactions"),
      db.exec("SELECT * FROM settings"),
      db.exec("SELECT * FROM tags"),
    ]);

  const data = {
    version: 3,
    exported_at: new Date().toISOString(),
    categories: categories.rows,
    transactions: transactions.rows,
    recurring_transactions: recurring.rows,
    settings: settings.rows,
    tags: tags.rows,
  };

  return JSON.stringify(data, null, 2);
}

export const CSV_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "payee", label: "Payee" },
  { key: "notes", label: "Notes" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "group_name", label: "Group" },
  { key: "frequency", label: "Recurring" },
] as const;

export type CSVColumnKey = typeof CSV_COLUMNS[number]["key"];

export interface CSVExportOptions {
  columns: CSVColumnKey[];
  type: "all" | "income" | "expense";
  dateFrom?: string;
  dateTo?: string;
  sortOrder: "desc" | "asc";
}

export const DEFAULT_CSV_OPTIONS: CSVExportOptions = {
  columns: ["date", "type", "amount", "payee", "category", "status"],
  type: "all",
  sortOrder: "desc",
};

export async function exportCSV(db: DbClient, options?: CSVExportOptions): Promise<string> {
  const opts = options ?? DEFAULT_CSV_OPTIONS;

  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.type === "income") {
    conditions.push("t.type = 'income'");
  } else if (opts.type === "expense") {
    conditions.push("t.type = 'expense'");
  }
  if (opts.dateFrom) {
    conditions.push("t.date >= ?");
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push("t.date <= ?");
    params.push(opts.dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.exec(
    `SELECT t.date, t.type, t.amount, t.payee, t.notes, t.status, t.group_name,
            COALESCE(c.name, '') as category,
            COALESCE(r.frequency, '') as frequency
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     LEFT JOIN recurring_transactions r ON t.recurring_id = r.id
     ${where}
     ORDER BY t.date ${opts.sortOrder === "asc" ? "ASC" : "DESC"}`,
    params
  );

  const colDefs = CSV_COLUMNS.filter((c) => opts.columns.includes(c.key));
  const headers = colDefs.map((c) => c.label);
  const csvRows = rows.map((row: any) =>
    colDefs.map((c) => csvEscape(String(row[c.key] ?? ""))).join(",")
  );

  return [headers.join(","), ...csvRows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function normalizeImportData(data: any): any {
  if (data.version < 3) {
    // Backfill anchor_day for old recurring rules
    if (data.recurring_transactions) {
      for (const rule of data.recurring_transactions) {
        if (!rule.anchor_day && ["monthly", "quarterly", "yearly"].includes(rule.frequency)) {
          rule.anchor_day = parseInt(rule.start_date?.slice(8, 10) ?? "1", 10);
        }
        if (rule.is_variable === undefined) {
          rule.is_variable = 0;
        }
      }
    }
  }
  return data;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
