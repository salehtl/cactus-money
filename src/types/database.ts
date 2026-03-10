export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_income: number; // SQLite boolean
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  amount: number;
  type: "income" | "expense";
  category_id: string | null;
  date: string; // YYYY-MM-DD
  payee: string;
  notes: string;
  recurring_id: string | null;
  status: "planned" | "confirmed" | "review";
  group_name: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface TransactionTag {
  transaction_id: string;
  tag_id: string;
}

export interface RecurringTransaction {
  id: string;
  amount: number;
  type: "income" | "expense";
  category_id: string | null;
  payee: string;
  notes: string;
  frequency:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "custom";
  custom_interval_days: number | null;
  start_date: string;
  end_date: string | null;
  next_occurrence: string;
  mode: "reminder" | "auto";
  is_active: number;
  anchor_day: number | null;
  is_variable: number;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Budget {
  id: string;
  category_id: string;
  month: string; // YYYY-MM
  amount: number;
  created_at: string;
  updated_at: string;
}
