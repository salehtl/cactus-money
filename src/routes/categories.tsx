import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { useCategories } from "../hooks/useCategories.ts";

export const Route = createFileRoute("/categories")({
  component: CategoriesPage,
});

const COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
  "#14b8a6", "#0ea5e9", "#f97316", "#64748b", "#16a34a",
  "#84cc16", "#06b6d4", "#a855f7", "#e11d48",
];

function CategoriesPage() {
  const { categories, expenseCategories, incomeCategories, add, update, remove } = useCategories();
  const { toast } = useToast();

  const [editId, setEditId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<"expense" | "income" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function handleSubmitEdit(id: string, data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) {
    await update(id, data);
    setEditId(null);
    toast("Category updated");
  }

  async function handleSubmitAdd(data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) {
    await add(data);
    setAddingIn(null);
    toast("Category added");
  }

  function handleStartEdit(id: string) {
    setEditId(id);
    setAddingIn(null);
  }

  function handleStartAdd(group: "expense" | "income") {
    setAddingIn(group);
    setEditId(null);
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        action={
          <Link
            to="/settings"
            className="text-sm text-text-muted hover:text-text transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Settings
          </Link>
        }
      />

      {categories.length === 0 ? (
        <p className="text-sm text-text-light">No categories</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CategoryColumn
            label="Expense"
            cats={expenseCategories}
            allCategories={categories}
            isIncome={false}
            editId={editId}
            addingIn={addingIn === "expense"}
            onEdit={handleStartEdit}
            onCancelEdit={() => setEditId(null)}
            onStartAdd={() => handleStartAdd("expense")}
            onCancelAdd={() => setAddingIn(null)}
            onSubmitEdit={handleSubmitEdit}
            onSubmitAdd={handleSubmitAdd}
            onDelete={(id) => { setEditId(null); setDeleteId(id); }}
          />
          <CategoryColumn
            label="Income"
            cats={incomeCategories}
            allCategories={categories}
            isIncome={true}
            editId={editId}
            addingIn={addingIn === "income"}
            onEdit={handleStartEdit}
            onCancelEdit={() => setEditId(null)}
            onStartAdd={() => handleStartAdd("income")}
            onCancelAdd={() => setAddingIn(null)}
            onSubmitEdit={handleSubmitEdit}
            onSubmitAdd={handleSubmitAdd}
            onDelete={(id) => { setEditId(null); setDeleteId(id); }}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (deleteId) {
            await remove(deleteId);
            toast("Category deleted");
          }
        }}
        title="Delete Category"
        message="Deleting this category will set related transactions to uncategorized. Continue?"
        confirmLabel="Delete"
      />
    </div>
  );
}

// --- Column ---

function CategoryColumn({
  label,
  cats,
  allCategories,
  isIncome,
  editId,
  addingIn,
  onEdit,
  onCancelEdit,
  onStartAdd,
  onCancelAdd,
  onSubmitEdit,
  onSubmitAdd,
  onDelete,
}: {
  label: string;
  cats: { id: string; name: string; color: string; is_system?: number | boolean; parent_id: string | null }[];
  allCategories: typeof cats;
  isIncome: boolean;
  editId: string | null;
  addingIn: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSubmitEdit: (id: string, data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) => Promise<void>;
  onSubmitAdd: (data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const parents = cats.filter((c) => !c.parent_id);
  const parentOptions = allCategories
    .filter((c) => !c.parent_id)
    .filter((c) => cats.some((gc) => gc.id === c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <section className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">{label}</h2>
        <span className="text-xs text-text-light">{cats.length}</span>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
        {parents.length === 0 && !addingIn ? (
          <p className="text-xs text-text-light px-3 py-3">No categories yet</p>
        ) : (
          parents.map((parent) => {
            const children = cats.filter((c) => c.parent_id === parent.id);
            return (
              <CategoryRow
                key={parent.id}
                cat={parent}
                children={children}
                editId={editId}
                onEdit={onEdit}
                onCancelEdit={onCancelEdit}
                parentOptions={parentOptions}
                isIncome={isIncome}
                onSubmit={onSubmitEdit}
                onDelete={onDelete}
              />
            );
          })
        )}
        {addingIn ? (
          <InlineCategoryForm
            parentOptions={parentOptions}
            isIncome={isIncome}
            onSubmit={onSubmitAdd}
            onCancel={onCancelAdd}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={onStartAdd}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-text-light hover:text-accent hover:bg-surface-alt/50 transition-colors cursor-pointer"
          >
            <PlusIcon />
            <span>Add category</span>
          </button>
        )}
      </div>
    </section>
  );
}

// --- Row ---

function CategoryRow({
  cat,
  children: childCats,
  isChild,
  editId,
  onEdit,
  onCancelEdit,
  parentOptions,
  isIncome,
  onSubmit,
  onDelete,
}: {
  cat: { id: string; name: string; color: string; is_system?: number | boolean; parent_id: string | null };
  children?: typeof cat[];
  isChild?: boolean;
  editId: string | null;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  parentOptions: { value: string; label: string }[];
  isIncome: boolean;
  onSubmit: (id: string, data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const isEditing = editId === cat.id;
  const hasChildren = childCats && childCats.length > 0;
  const [expanded, setExpanded] = useState(false);
  const isSystem = !!cat.is_system;

  if (isEditing) {
    return (
      <InlineCategoryForm
        initial={{ name: cat.name, parent_id: cat.parent_id, color: cat.color }}
        parentOptions={isChild ? [] : parentOptions}
        isIncome={isIncome}
        onSubmit={(data) => onSubmit(cat.id, data)}
        onCancel={onCancelEdit}
        onDelete={!isSystem ? () => onDelete(cat.id) : undefined}
        autoFocus
      />
    );
  }

  return (
    <>
      <div
        className={`group flex items-center gap-2 px-3 py-2 transition-colors ${
          isChild ? "pl-8" : ""
        } ${isSystem ? "" : "hover:bg-surface-alt/80 cursor-pointer"}`}
        onClick={() => { if (!isSystem) onEdit(cat.id); }}
      >
        {!isChild && hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0.5 -ml-1 text-text-light hover:text-text-muted cursor-pointer"
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : (
          <span className={`${isChild ? "" : "w-[18px]"}`} />
        )}
        <div
          className={`${isChild ? "w-2 h-2" : "w-2.5 h-2.5"} rounded-full shrink-0`}
          style={{ backgroundColor: cat.color }}
        />
        <span className={`text-sm ${isChild ? "text-text-muted" : "font-medium"} flex-1 min-w-0 truncate`}>
          {cat.name}
        </span>
        {hasChildren && !expanded && (
          <span className="text-[10px] text-text-light">{childCats!.length}</span>
        )}
        {isSystem && (
          <span className="text-[10px] text-text-light bg-surface-alt px-1.5 py-0.5 rounded">
            System
          </span>
        )}
        {!isSystem && (
          <span className="text-text-light opacity-0 group-hover:opacity-100 transition-opacity">
            <PencilIcon />
          </span>
        )}
      </div>
      {hasChildren && expanded && childCats!.map((child) => (
        <CategoryRow
          key={child.id}
          cat={child}
          isChild
          editId={editId}
          onEdit={onEdit}
          onCancelEdit={onCancelEdit}
          parentOptions={[]}
          isIncome={isIncome}
          onSubmit={onSubmit}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

// --- Inline form ---

function InlineCategoryForm({
  initial,
  parentOptions,
  isIncome,
  onSubmit,
  onCancel,
  onDelete,
  autoFocus,
}: {
  initial?: { name: string; parent_id: string | null; color: string };
  parentOptions: { value: string; label: string }[];
  isIncome: boolean;
  onSubmit: (data: { name: string; parent_id?: string | null; color: string; is_income: boolean }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState(initial?.parent_id ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]!);
  const [showColors, setShowColors] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSubmit({ name: name.trim(), parent_id: parentId || null, color, is_income: isIncome });
  }

  return (
    <form onSubmit={handleSubmit} className="py-2.5 px-3 bg-surface-alt/60 animate-slide-up">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowColors(!showColors)}
          className="w-5 h-5 rounded-full shrink-0 cursor-pointer ring-1 ring-border transition-shadow hover:ring-accent"
          style={{ backgroundColor: color }}
          title="Change color"
        />
        <input
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-light min-w-0"
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        />
        {parentOptions.length > 0 && (
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="text-xs bg-transparent border border-border rounded px-1.5 py-1 outline-none text-text-muted max-w-[120px]"
          >
            <option value="">Top-level</option>
            {parentOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {onDelete && (
            <button type="button" onClick={onDelete} className="p-1 text-danger/60 hover:text-danger rounded cursor-pointer" title="Delete">
              <TrashIcon />
            </button>
          )}
          <button type="button" onClick={onCancel} className="px-2 py-1 text-xs text-text-muted hover:text-text rounded cursor-pointer">
            Esc
          </button>
          <button type="submit" disabled={!name.trim()} className="px-2.5 py-1 text-xs font-medium bg-accent text-white rounded cursor-pointer hover:bg-accent/90 disabled:opacity-40">
            {initial ? "Save" : "Add"}
          </button>
        </div>
      </div>
      {showColors && (
        <div className="flex flex-wrap gap-1.5 mt-2 ml-7 animate-slide-up">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setColor(c); setShowColors(false); }}
              className={`w-5 h-5 rounded-full cursor-pointer transition-all ${
                color === c ? "ring-2 ring-offset-1 ring-accent scale-110" : "hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </form>
  );
}

// --- Icons ---

function ChevronIcon({ expanded, className = "" }: { expanded: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""} ${className}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  );
}
