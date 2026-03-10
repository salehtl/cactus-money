export const SCHEMA_VERSION = 4;

export const BACKUP_TABLES = [
  "categories",
  "transactions",
  "recurring_transactions",
  "tags",
  "settings",
] as const;

export const ANCHOR_DAY_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

/** SQL fragment appended to dynamic UPDATE SET clauses to touch updated_at. */
export const SET_UPDATED_AT = "updated_at = datetime('now')" as const;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_income INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  recurring_id TEXT REFERENCES recurring_transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  group_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  payee TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  custom_interval_days INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_occurrence TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'reminder' CHECK (mode IN ('reminder', 'auto')),
  is_active INTEGER NOT NULL DEFAULT 1,
  anchor_day INTEGER,
  is_variable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, month)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_recurring ON transactions(recurring_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring_transactions(next_occurrence);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);
`;

export const MIGRATIONS: Record<number, string> = {
  1: `
CREATE TABLE IF NOT EXISTS cashflow_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount REAL NOT NULL DEFAULT 0,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  group_name TEXT NOT NULL DEFAULT '',
  month TEXT,
  recurring_id TEXT REFERENCES recurring_transactions(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cashflow_items_month ON cashflow_items(month);
CREATE INDEX IF NOT EXISTS idx_cashflow_items_type ON cashflow_items(type);
`,
  2: `
ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE transactions ADD COLUMN group_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
INSERT INTO transactions (id, amount, type, category_id, date, payee, notes, recurring_id, status, group_name)
  SELECT id, amount, type, category_id,
    CASE WHEN month IS NOT NULL THEN month || '-01' ELSE date('now') END,
    label, '', recurring_id, 'planned', group_name
  FROM cashflow_items;
DROP TABLE IF EXISTS cashflow_items;
`,
  3: `
ALTER TABLE recurring_transactions ADD COLUMN anchor_day INTEGER;
ALTER TABLE recurring_transactions ADD COLUMN is_variable INTEGER NOT NULL DEFAULT 0;
UPDATE recurring_transactions
  SET anchor_day = CAST(substr(start_date, 9, 2) AS INTEGER)
  WHERE frequency IN ('monthly', 'quarterly', 'yearly');
`,
};
