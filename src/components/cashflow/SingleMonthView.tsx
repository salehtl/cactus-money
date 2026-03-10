import { useState, useRef, useEffect, useMemo } from "react";
import type { CashflowGroup, CashflowRow, CashflowSummary } from "../../lib/cashflow.ts";
import type { Category, RecurringTransaction } from "../../types/database.ts";
import { formatCurrency, formatDateShort, getToday } from "../../lib/format.ts";
import { CategoryCombo } from "../ui/CategoryCombo.tsx";
import { DatePicker } from "../ui/Calendar.tsx";
import { StatusPill } from "../ui/StatusPill.tsx";

const FREQUENCIES: { value: RecurringTransaction["frequency"]; label: string; short: string }[] = [
  { value: "weekly", label: "Weekly", short: "Wk" },
  { value: "biweekly", label: "Biweekly", short: "2W" },
  { value: "monthly", label: "Monthly", short: "Mo" },
  { value: "quarterly", label: "Quarterly", short: "Qt" },
  { value: "yearly", label: "Yearly", short: "Yr" },
];

// Shared grid: Payee | Date | Category | Recur | Amount | Status | Actions
// Proportional fr columns for content; fixed px for utility columns.
const GRID_COLS = "grid-cols-[3fr_1.2fr_1.5fr_52px_1.5fr_56px_48px]";

interface SingleMonthViewProps {
  incomeGroups: CashflowGroup[];
  expenseGroups: CashflowGroup[];
  summary: CashflowSummary;
  month: string;
  categories?: Category[];
  onToggleStatus: (id: string, newStatus: "planned" | "confirmed" | "review") => void;
  onDeleteRow: (id: string) => void;
  onStopRecurrence?: (recurringId: string) => void;
  onEditRow: (id: string, updates: { payee?: string; amount?: number; type?: "income" | "expense"; category_id?: string | null; date?: string; group_name?: string; status?: "planned" | "confirmed" | "review" }) => void;
  onAddRow: (data: {
    payee: string;
    type: "income" | "expense";
    amount: number;
    category_id: string | null;
    date: string;
    status: "planned" | "confirmed";
    group_name: string;
    recurring?: {
      frequency: RecurringTransaction["frequency"];
      custom_interval_days?: number | null;
      end_date?: string | null;
    };
  }) => void | Promise<void>;
  onDuplicateRow?: (row: CashflowRow) => void;
  onCreateCategory?: (name: string, isIncome: boolean) => Promise<string>;
}

export function SingleMonthView({
  incomeGroups,
  expenseGroups,
  summary,
  month,
  categories,
  onToggleStatus,
  onDeleteRow,
  onStopRecurrence,
  onEditRow,
  onAddRow,
  onDuplicateRow,
  onCreateCategory,
}: SingleMonthViewProps) {
  const reviewCount = useMemo(
    () =>
      [...incomeGroups, ...expenseGroups]
        .flatMap((g) => g.rows)
        .filter((r) => r.status === "review").length,
    [incomeGroups, expenseGroups]
  );

  const firstReviewRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="flex items-stretch gap-3 overflow-x-auto">
        <SummaryCard
          label="Income"
          amount={summary.income}
          variant="income"
          confirmed={summary.confirmedIncome}
          planned={summary.plannedIncome}
        />
        <SummaryCard
          label="Expenses"
          amount={summary.expenses}
          variant="expense"
          confirmed={summary.confirmedExpenses}
          planned={summary.plannedExpenses}
        />
        <SummaryCard
          label="Net"
          amount={summary.net}
          variant={summary.net >= 0 ? "income" : "expense"}
        />
      </div>

      {/* Review banner */}
      <ReviewBanner
        count={reviewCount}
        onReview={() => firstReviewRef.current?.scrollIntoView({ behavior: "smooth" })}
      />

      {/* Income section */}
      <TableSection
        title="Income"
        variant="income"
        total={summary.income}
        groups={incomeGroups}
        month={month}
        categories={categories}
        onToggleStatus={onToggleStatus}
        onDeleteRow={onDeleteRow}
        onStopRecurrence={onStopRecurrence}
        onEditRow={onEditRow}
        onAddRow={onAddRow}
        onDuplicateRow={onDuplicateRow}
        onCreateCategory={onCreateCategory}
      />

      {/* Expense section */}
      <TableSection
        title="Expenses"
        variant="expense"
        total={summary.expenses}
        groups={expenseGroups}
        month={month}
        categories={categories}
        onToggleStatus={onToggleStatus}
        onDeleteRow={onDeleteRow}
        onStopRecurrence={onStopRecurrence}
        onEditRow={onEditRow}
        onAddRow={onAddRow}
        onDuplicateRow={onDuplicateRow}
        onCreateCategory={onCreateCategory}
      />
    </div>
  );
}

// --- Review banner ---

function ReviewBanner({ count, onReview }: { count: number; onReview: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-warning/10 border border-warning/20 rounded-xl text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0" />
        <span className="text-text">
          <strong>{count}</strong> recurring {count === 1 ? "item needs" : "items need"} updated amounts
        </span>
      </div>
      <button
        type="button"
        onClick={onReview}
        className="text-warning font-semibold hover:underline cursor-pointer shrink-0"
      >
        Review
      </button>
    </div>
  );
}

// --- Summary card ---

function SummaryCard({
  label,
  amount,
  variant,
  confirmed,
  planned,
}: {
  label: string;
  amount: number;
  variant: "income" | "expense";
  confirmed?: number;
  planned?: number;
}) {
  const hasBreakdown = confirmed !== undefined && planned !== undefined && planned > 0;

  return (
    <div className="flex-1 min-w-[130px] bg-surface rounded-xl border border-border p-3">
      <p className="text-[11px] text-text-muted font-medium tracking-wide uppercase">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${variant === "income" ? "text-success" : "text-danger"}`}>
        {formatCurrency(amount)}
      </p>
      <div className={`mt-1.5 flex items-center gap-2 text-[10px] text-text-light h-4 ${hasBreakdown ? "visible" : "invisible"}`}>
        <span>{formatCurrency(confirmed ?? 0)} conf.</span>
        <span className="italic">+{formatCurrency(planned ?? 0)} plan.</span>
      </div>
    </div>
  );
}

// --- Table section ---

function TableSection({
  title,
  variant,
  total,
  groups,
  month,
  categories,
  onToggleStatus,
  onDeleteRow,
  onStopRecurrence,
  onEditRow,
  onAddRow,
  onDuplicateRow,
  onCreateCategory,
}: {
  title: string;
  variant: "income" | "expense";
  total: number;
  groups: CashflowGroup[];
  month: string;
  categories?: Category[];
  onToggleStatus: SingleMonthViewProps["onToggleStatus"];
  onDeleteRow: SingleMonthViewProps["onDeleteRow"];
  onStopRecurrence?: SingleMonthViewProps["onStopRecurrence"];
  onEditRow: SingleMonthViewProps["onEditRow"];
  onAddRow: SingleMonthViewProps["onAddRow"];
  onDuplicateRow?: SingleMonthViewProps["onDuplicateRow"];
  onCreateCategory?: SingleMonthViewProps["onCreateCategory"];
}) {
  const rowCount = groups.reduce((s, g) => s + g.rows.length, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${variant === "income" ? "text-success" : "text-danger"}`}>
            {title}
          </h3>
          <span className="text-[10px] font-medium text-text-light bg-surface-alt border border-border rounded-full px-1.5 py-0.5 tabular-nums leading-none">
            {rowCount}
          </span>
        </div>
        <span className={`text-xs font-bold tabular-nums ${variant === "income" ? "text-success" : "text-danger"}`}>
          {formatCurrency(total)}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        {/* Column header */}
        <div className={`grid ${GRID_COLS} gap-x-3 px-3 py-2 bg-surface-alt border-b border-border text-[10px] font-semibold text-text-light uppercase tracking-wider rounded-t-xl`}>
          <span>Payee</span>
          <span className="text-center hidden sm:block">Date</span>
          <span className="text-center hidden sm:block">Category</span>
          <span className="text-center hidden sm:block">Recur</span>
          <span className="text-right">Amount</span>
          <span className="text-center">Status</span>
          <span />
        </div>

        {groups.map((group) => (
          <GroupBlock
            key={group.name || "__ungrouped"}
            group={group}
            variant={variant}
            categories={categories}
            onToggleStatus={onToggleStatus}
            onDeleteRow={onDeleteRow}
            onStopRecurrence={onStopRecurrence}
            onEditRow={onEditRow}
            onDuplicateRow={onDuplicateRow}
            onCreateCategory={onCreateCategory}
          />
        ))}

        {/* Inline add */}
        <InlineAddRow
          type={variant}
          month={month}
          categories={categories}
          groups={groups}
          onAddRow={onAddRow}
          onCreateCategory={onCreateCategory}
        />
      </div>
    </div>
  );
}

// --- Group block ---

function GroupBlock({
  group,
  variant,
  categories,
  onToggleStatus,
  onDeleteRow,
  onStopRecurrence,
  onEditRow,
  onDuplicateRow,
  onCreateCategory,
}: {
  group: CashflowGroup;
  variant: "income" | "expense";
  categories?: Category[];
  onToggleStatus: SingleMonthViewProps["onToggleStatus"];
  onDeleteRow: SingleMonthViewProps["onDeleteRow"];
  onStopRecurrence?: SingleMonthViewProps["onStopRecurrence"];
  onEditRow: SingleMonthViewProps["onEditRow"];
  onDuplicateRow?: SingleMonthViewProps["onDuplicateRow"];
  onCreateCategory?: SingleMonthViewProps["onCreateCategory"];
}) {
  const [expanded, setExpanded] = useState(true);
  const hasGroupName = group.name !== "";

  if (!hasGroupName) {
    return (
      <>
        {group.rows.map((row) => (
          <ItemRow
            key={row.id}
            row={row}
            variant={variant}
            categories={categories}
            onToggleStatus={onToggleStatus}
            onDeleteRow={onDeleteRow}
            onStopRecurrence={onStopRecurrence}
            onEditRow={onEditRow}
            onDuplicateRow={onDuplicateRow}
            onCreateCategory={onCreateCategory}
          />
        ))}
      </>
    );
  }

  return (
    <div>
      <div
        className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2 cursor-pointer hover:bg-surface-alt/80 transition-colors border-b border-border bg-surface-alt/40"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <svg
            className={`w-3 h-3 text-text-light transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-xs font-semibold text-text truncate">{group.name}</span>
          <span className="text-[10px] text-text-light tabular-nums shrink-0">
            {group.rows.length}
          </span>
        </div>
        <span className="text-xs font-semibold tabular-nums pr-1">
          {formatCurrency(group.total)}
        </span>
      </div>

      {expanded && group.rows.map((row) => (
        <ItemRow
          key={row.id}
          row={row}
          variant={variant}
          categories={categories}
          onToggleStatus={onToggleStatus}
          onDeleteRow={onDeleteRow}
          onStopRecurrence={onStopRecurrence}
          onEditRow={onEditRow}
          onDuplicateRow={onDuplicateRow}
          onCreateCategory={onCreateCategory}
        />
      ))}
    </div>
  );
}

// --- Shared input styles ---

const inputBase = "bg-transparent outline-none transition-colors";
const inputUnderline = "border-b border-accent/30 focus:border-accent";
const inputUnderlineIdle = "border-b border-transparent focus:border-accent/40";

// --- Item row ---

function ItemRow({
  row,
  variant,
  categories,
  onToggleStatus,
  onDeleteRow,
  onStopRecurrence,
  onEditRow,
  onDuplicateRow,
  onCreateCategory,
}: {
  row: CashflowRow;
  variant: "income" | "expense";
  categories?: Category[];
  onToggleStatus: SingleMonthViewProps["onToggleStatus"];
  onDeleteRow: SingleMonthViewProps["onDeleteRow"];
  onStopRecurrence?: SingleMonthViewProps["onStopRecurrence"];
  onEditRow: SingleMonthViewProps["onEditRow"];
  onDuplicateRow?: SingleMonthViewProps["onDuplicateRow"];
  onCreateCategory?: SingleMonthViewProps["onCreateCategory"];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editPayee, setEditPayee] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editStatus, setEditStatus] = useState<"planned" | "confirmed">("confirmed");
  const [editType, setEditType] = useState<"income" | "expense">("expense");
  const editRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function startEditing() {
    setEditPayee(row.label);
    setEditAmount(String(row.amount));
    setEditDate(row.date);
    setEditCategoryId(row.categoryId ?? "");
    setEditStatus(row.status);
    setEditType(row.type);
    setEditing(true);
    requestAnimationFrame(() => editRef.current?.focus());
  }

  function saveEdit() {
    const newPayee = editPayee.trim();
    const newAmount = parseFloat(editAmount);
    if (!newPayee || !newAmount || newAmount <= 0) return;

    const updates: Parameters<typeof onEditRow>[1] = {};
    if (newPayee !== row.label) updates.payee = newPayee;
    if (newAmount !== row.amount) updates.amount = newAmount;
    if (editDate !== row.date) updates.date = editDate;
    if (editType !== row.type) updates.type = editType;
    if ((editCategoryId || null) !== row.categoryId) updates.category_id = editCategoryId || null;
    if (editStatus !== row.status) updates.status = editStatus;

    if (Object.keys(updates).length > 0) {
      onEditRow(row.id, updates);
    }
    setEditing(false);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
    if (e.key === "Escape") setEditing(false);
  }

  // --- Edit mode ---
  if (editing) {
    const filteredCategories = (categories ?? []).filter((c) =>
      editType === "income" ? c.is_income : !c.is_income
    );
    return (
      <div className="border-b border-border/60 last:border-b-0 bg-accent/[0.03]">
        <div className={`grid ${GRID_COLS} gap-x-3 items-center px-3 h-9`}>
          {/* Payee + Type toggle */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => { setEditType(editType === "income" ? "expense" : "income"); setEditCategoryId(""); }}
              className={`text-[9px] font-bold px-1 py-px rounded cursor-pointer shrink-0 ${
                editType === "income" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
              }`}
              title={`Switch to ${editType === "income" ? "expense" : "income"}`}
            >
              {editType === "income" ? "IN" : "EX"}
            </button>
            <input
              ref={editRef}
              type="text"
              value={editPayee}
              onChange={(e) => setEditPayee(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className={`flex-1 min-w-0 text-[13px] text-text py-0.5 ${inputBase} ${inputUnderline}`}
            />
          </div>

          {/* Date */}
          <div className="hidden sm:block">
            <DatePicker
              value={editDate}
              onChange={setEditDate}
              variant="inline"
            />
          </div>

          {/* Category */}
          <div className="hidden sm:block">
            <CategoryCombo
              value={editCategoryId}
              onChange={setEditCategoryId}
              categories={filteredCategories}
              variant="edit"
              onCreateCategory={onCreateCategory ? (name) => onCreateCategory(name, editType === "income") : undefined}
            />
          </div>

          {/* Recurring (read-only) */}
          <div className="hidden sm:flex justify-center">
            {row.frequency ? (
              <span className="text-[10px] text-accent font-semibold">
                {FREQUENCIES.find((f) => f.value === row.frequency)?.short ?? row.frequency}
              </span>
            ) : (
              <span className="text-[10px] text-border-dark">&mdash;</span>
            )}
          </div>

          {/* Amount */}
          <input
            type="number"
            step="0.01"
            min="0"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            onKeyDown={handleEditKeyDown}
            className={`text-[13px] text-right tabular-nums text-text py-0.5 ${inputBase} ${inputUnderline}`}
          />

          {/* Status */}
          <div className="flex justify-center">
            <StatusPill
              status={editStatus}
              onClick={() => setEditStatus(editStatus === "planned" ? "confirmed" : "planned")}
            />
          </div>

          {/* Save / Cancel */}
          <div className="flex justify-center gap-px">
            <button onClick={saveEdit} className="p-1 rounded-md text-accent hover:bg-accent/10 cursor-pointer" title="Save (Enter)">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button onClick={() => setEditing(false)} className="p-1 rounded-md text-text-light hover:bg-surface-alt hover:text-text-muted cursor-pointer" title="Cancel (Esc)">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Display mode ---
  const isPlanned = row.status === "planned" || row.status === "review";
  const nextStatus = row.status === "confirmed" ? "planned" : "confirmed";
  const secondaryInfo = [
    formatDateShort(row.date),
    row.categoryName,
    row.frequency ? FREQUENCIES.find((f) => f.value === row.frequency)?.short : null,
  ].filter(Boolean).join(" \u00b7 ");

  return (
    <div className="group border-b border-border/60 last:border-b-0">
      <div onDoubleClick={startEditing} className={`grid ${GRID_COLS} gap-x-3 items-center px-3 py-1.5 sm:py-0 sm:h-9 hover:bg-surface-alt/50 transition-colors cursor-default`}>
        {/* Payee */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: row.categoryColor ?? "var(--color-border-dark)" }}
          />
          <div className="min-w-0">
            <span className={`text-[13px] truncate block ${isPlanned ? "text-text-muted" : "text-text"}`}>
              {row.label}
            </span>
            {/* Mobile secondary info: date, category, recur */}
            <span className="text-[10px] text-text-light truncate block sm:hidden leading-tight">
              {secondaryInfo}
            </span>
          </div>
        </div>

        {/* Date */}
        <span className="text-[11px] text-text-light text-center hidden sm:block tabular-nums">
          {formatDateShort(row.date)}
        </span>

        {/* Category */}
        <span className="text-[11px] text-text-muted text-center truncate hidden sm:block" title={row.categoryName ?? undefined}>
          {row.categoryName ?? "\u2014"}
        </span>

        {/* Recurring */}
        <div className="hidden sm:flex justify-center">
          {row.frequency ? (
            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-semibold bg-accent/8 text-accent leading-tight">
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
              {FREQUENCIES.find((f) => f.value === row.frequency)?.short ?? row.frequency}
            </span>
          ) : (
            <span className="text-[10px] text-border-dark">&mdash;</span>
          )}
        </div>

        {/* Amount */}
        <span className={`text-[13px] font-medium tabular-nums text-right ${isPlanned ? "text-text-muted" : "text-text"}`}>
          {formatCurrency(row.amount)}
        </span>

        {/* Status pill */}
        <div className="flex justify-center">
          <StatusPill
            status={row.status}
            onClick={() => onToggleStatus(row.id, nextStatus)}
          />
        </div>

        {/* Actions */}
        <div className="relative flex items-center justify-end gap-px" ref={menuRef}>
          <button
            onClick={startEditing}
            className="p-1 rounded-md text-text-light hover:text-accent sm:opacity-0 sm:group-hover:opacity-100 transition-opacity cursor-pointer"
            title="Edit"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded-md text-text-light hover:text-text-muted sm:opacity-0 sm:group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-[70] min-w-[160px] rounded-lg border border-border bg-surface shadow-lg py-1 animate-slide-up">
              {onDuplicateRow && (
                <button
                  onClick={() => { onDuplicateRow(row); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-text-muted hover:bg-surface-alt hover:text-text transition-colors cursor-pointer"
                >
                  Duplicate
                </button>
              )}
              {row.isRecurring && row.recurringId && onStopRecurrence && (
                <button
                  onClick={() => { onStopRecurrence(row.recurringId!); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-text-muted hover:bg-surface-alt hover:text-text transition-colors cursor-pointer"
                >
                  Stop recurrence
                </button>
              )}
              <button
                onClick={() => { onDeleteRow(row.id); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 sm:py-1.5 text-xs text-danger hover:bg-danger-light/30 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Inline add row ---

function InlineAddRow({
  type,
  month,
  categories,
  groups,
  onAddRow,
  onCreateCategory,
}: {
  type: "income" | "expense";
  month: string;
  categories?: Category[];
  groups: CashflowGroup[];
  onAddRow: SingleMonthViewProps["onAddRow"];
  onCreateCategory?: SingleMonthViewProps["onCreateCategory"];
}) {
  const draftKey = `cashflow-draft-${type}`;

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch { /* ignore */ }
    return null;
  }

  const draft = loadDraft();
  const [active, setActive] = useState(!!draft);
  const [payee, setPayee] = useState(draft?.payee ?? "");
  const [amount, setAmount] = useState(draft?.amount ?? "");
  const [date, setDate] = useState(draft?.date ?? getToday());
  const [categoryId, setCategoryId] = useState(draft?.categoryId ?? "");
  const [frequency, setFrequency] = useState(draft?.frequency ?? "");
  const [status, setStatus] = useState<"planned" | "confirmed">((draft?.status as "planned" | "confirmed") ?? "confirmed");
  const [statusManual, setStatusManual] = useState(draft?.statusManual === "true");
  const [groupName, setGroupName] = useState(draft?.groupName ?? "");
  const [saving, setSaving] = useState(false);
  const payeeRef = useRef<HTMLInputElement>(null);

  // Persist draft to sessionStorage on changes
  useEffect(() => {
    if (!active) {
      sessionStorage.removeItem(draftKey);
      return;
    }
    sessionStorage.setItem(draftKey, JSON.stringify({
      payee, amount, date, categoryId, frequency, status, statusManual: String(statusManual), groupName,
    }));
  }, [active, payee, amount, date, categoryId, frequency, status, statusManual, groupName, draftKey]);

  const filteredCategories = (categories ?? []).filter((c) =>
    type === "income" ? c.is_income : !c.is_income
  );
  const existingGroups = [...new Set(groups.map((g) => g.name).filter(Boolean))];

  useEffect(() => {
    if (active) requestAnimationFrame(() => payeeRef.current?.focus());
  }, [active]);

  function handleDateChange(newDate: string) {
    setDate(newDate);
    if (!statusManual) {
      setStatus(newDate > getToday() ? "planned" : "confirmed");
    }
  }

  function handleStatusToggle() {
    setStatusManual(true);
    setStatus(status === "planned" ? "confirmed" : "planned");
  }

  function reset() {
    setPayee("");
    setAmount("");
    setDate(getToday());
    setCategoryId("");
    setFrequency("");
    setStatus("confirmed");
    setStatusManual(false);
    setGroupName("");
    setActive(false);
  }

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!payee.trim() || !amt || amt <= 0) return;

    setSaving(true);
    await onAddRow({
      payee: payee.trim(),
      type,
      amount: amt,
      category_id: categoryId || null,
      date,
      status,
      group_name: groupName.trim(),
      ...(frequency
        ? { recurring: { frequency: frequency as RecurringTransaction["frequency"], custom_interval_days: null, end_date: null } }
        : {}),
    });
    setSaving(false);
    setPayee("");
    setAmount("");
    setDate(getToday());
    setCategoryId("");
    setFrequency("");
    setStatus("confirmed");
    setStatusManual(false);
    setGroupName("");
    requestAnimationFrame(() => payeeRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
    if (e.key === "Escape") reset();
  }

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="w-full flex items-center gap-2 px-3 h-9 text-text-light hover:text-text-muted hover:bg-surface-alt/60 transition-colors cursor-pointer group"
      >
        <svg className="w-3.5 h-3.5 text-border-dark group-hover:text-text-light transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="text-xs">Add item</span>
      </button>
    );
  }

  return (
    <div className="border-t border-dashed border-accent/30 bg-accent/[0.03]">
      <div className={`grid ${GRID_COLS} gap-x-3 items-center px-3 h-9`}>
        {/* Payee */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent/40 shrink-0" />
          <input
            ref={payeeRef}
            type="text"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Payee..."
            className={`flex-1 min-w-0 text-[13px] text-text placeholder:text-text-light/50 py-0.5 ${inputBase} ${inputUnderlineIdle}`}
            disabled={saving}
          />
        </div>

        {/* Date */}
        <div className="hidden sm:block">
          <DatePicker
            value={date}
            onChange={handleDateChange}
            variant="inline"
            disabled={saving}
          />
        </div>

        {/* Category */}
        <div className="hidden sm:block">
          <CategoryCombo
            value={categoryId}
            onChange={setCategoryId}
            categories={filteredCategories}
            variant="add"
            disabled={saving}
            onCreateCategory={onCreateCategory ? (name) => onCreateCategory(name, type === "income") : undefined}
          />
        </div>

        {/* Recurring */}
        <div className="relative hidden sm:block">
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className={`w-full appearance-none text-[10px] text-center py-0.5 cursor-pointer pr-3 ${inputBase} border-b ${
              frequency ? "text-accent font-semibold border-accent/40" : "text-text-light border-transparent focus:border-accent/40"
            }`}
            disabled={saving}
          >
            <option value="">&mdash;</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.short}</option>
            ))}
          </select>
          <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-text-light/60 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </div>

        {/* Amount */}
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="0.00"
          className={`text-[13px] text-right tabular-nums text-text placeholder:text-text-light/50 py-0.5 ${inputBase} ${inputUnderlineIdle}`}
          disabled={saving}
        />

        {/* Status */}
        <div className="flex justify-center">
          <StatusPill status={status} onClick={handleStatusToggle} disabled={saving} />
        </div>

        {/* Add / Cancel */}
        <div className="flex justify-center gap-px">
          <button
            onClick={handleSubmit}
            disabled={saving || !payee.trim() || !amount || parseFloat(amount) <= 0}
            className="p-1 rounded-md text-accent hover:bg-accent/10 disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
            title="Add (Enter)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            onClick={reset}
            className="p-1 rounded-md text-text-light hover:bg-surface-alt hover:text-text-muted cursor-pointer"
            title="Cancel (Esc)"
            disabled={saving}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Group selector (secondary row, only when groups exist) */}
      {existingGroups.length > 0 && (
        <div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5">
          <div className="relative">
            <select
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="appearance-none pl-2 pr-5 py-0.5 rounded border border-border bg-surface text-[11px] text-text-muted outline-none focus:border-accent cursor-pointer"
              disabled={saving}
            >
              <option value="">Group...</option>
              {existingGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <svg className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-text-light pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
          </div>
          <span className="text-[10px] text-text-light/40 hidden sm:block">Enter to add / Esc to cancel</span>
        </div>
      )}
    </div>
  );
}
