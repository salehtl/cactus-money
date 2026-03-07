import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { useDb } from "../context/DbContext.tsx";
import { useCategories } from "../hooks/useCategories.ts";
import { exportJSON, exportCSV, downloadFile } from "../lib/export.ts";
import { importJSON } from "../lib/import.ts";
import {
  isFileSystemAccessSupported,
  pickDirectory,
  getStoredDirectory,
  autoExport,
} from "../lib/fs-sync.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { emitDbEvent } from "../lib/db-events.ts";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
  "#14b8a6", "#0ea5e9", "#f97316", "#64748b", "#16a34a",
  "#84cc16", "#06b6d4", "#a855f7", "#e11d48",
];

function SettingsPage() {
  const db = useDb();
  const { toast } = useToast();

  const [lastExport, setLastExport] = useState<string | null>(null);
  const [hasDir, setHasDir] = useState(false);
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importData, setImportData] = useState<string | null>(null);

  useEffect(() => {
    getSetting(db, "last_export").then(setLastExport);
    getSetting(db, "auto_export").then((v) => setAutoExportEnabled(v === "true"));
    getStoredDirectory().then((h) => setHasDir(!!h));
  }, [db]);

  async function handleExportJSON() {
    try {
      const json = await exportJSON(db);
      downloadFile(json, `budget-backup-${new Date().toISOString().split("T")[0]}.json`, "application/json");
      const now = new Date().toISOString();
      await setSetting(db, "last_export", now);
      setLastExport(now);
      toast("JSON exported successfully");
    } catch {
      toast("Export failed", "error");
    }
  }

  async function handleExportCSV() {
    try {
      const csv = await exportCSV(db);
      downloadFile(csv, `transactions-${new Date().toISOString().split("T")[0]}.csv`, "text/csv");
      toast("CSV exported successfully");
    } catch {
      toast("Export failed", "error");
    }
  }

  function handleImportSelect() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      setImportData(text);
      setShowImportConfirm(true);
    };
    input.click();
  }

  async function handleImportConfirm() {
    if (!importData) return;
    try {
      await importJSON(db, importData);
      emitDbEvent("transactions-changed");
      emitDbEvent("categories-changed");
      emitDbEvent("recurring-changed");
      emitDbEvent("settings-changed");
      toast("Data imported successfully");
    } catch (e: any) {
      toast(`Import failed: ${e.message}`, "error");
    }
    setImportData(null);
  }

  async function handlePickDirectory() {
    const handle = await pickDirectory();
    if (handle) {
      setHasDir(true);
      toast("Directory linked for auto-export");
    }
  }

  async function handleForceExport() {
    const success = await autoExport(db);
    if (success) {
      const now = new Date().toISOString();
      await setSetting(db, "last_export", now);
      setLastExport(now);
      toast("Exported to directory");
    } else {
      toast("Export failed - check directory permissions", "error");
    }
  }

  async function toggleAutoExport() {
    const newValue = !autoExportEnabled;
    await setSetting(db, "auto_export", String(newValue));
    setAutoExportEnabled(newValue);
  }

  return (
    <div>
      <PageHeader title="Settings" />

      {/* AI Integration section */}
      <AIIntegrationSection />

      {/* Auto-export section */}
      {isFileSystemAccessSupported() && (
        <section className="bg-surface rounded-xl border border-border p-4 mb-4">
          <h2 className="text-sm font-bold mb-3">Auto-Export to Directory</h2>
          <p className="text-xs text-text-muted mb-3">
            Automatically save a backup file to a chosen directory after each change.
            Great for syncing with iCloud, Dropbox, etc.
          </p>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={handlePickDirectory}>
                {hasDir ? "Change Directory" : "Choose Directory"}
              </Button>
              {hasDir && (
                <span className="text-xs text-success">Directory linked</span>
              )}
            </div>
            {hasDir && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="auto-export"
                    checked={autoExportEnabled}
                    onChange={toggleAutoExport}
                    className="rounded"
                  />
                  <label
                    htmlFor="auto-export"
                    className="text-sm text-text-muted"
                  >
                    Enable auto-export
                  </label>
                </div>
                <Button variant="secondary" size="sm" onClick={handleForceExport}>
                  Export Now
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      {/* Manual export/import */}
      <section className="bg-surface rounded-xl border border-border p-4 mb-4">
        <h2 className="text-sm font-bold mb-3">Export & Import</h2>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleExportJSON}>
              Export JSON
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportCSV}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={handleImportSelect}>
              Import JSON
            </Button>
          </div>
          {lastExport && (
            <p className="text-xs text-text-light">
              Last export: {new Date(lastExport).toLocaleString()}
            </p>
          )}
        </div>
      </section>

      {/* Categories section */}
      <CategoriesSection />

      {/* About */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold mb-3">About</h2>
        <div className="space-y-1.5 text-xs text-text-muted">
          <p>Budget App v2.0.0</p>
          <p>Storage: {db.storageType.toUpperCase()}</p>
          <p>Currency: AED (UAE Dirham)</p>
          <p>All data stored locally on this device.</p>
        </div>
      </section>

      <ConfirmDialog
        open={showImportConfirm}
        onClose={() => {
          setShowImportConfirm(false);
          setImportData(null);
        }}
        onConfirm={handleImportConfirm}
        title="Import Data"
        message="This will replace ALL existing data with the imported backup. This cannot be undone. Continue?"
        confirmLabel="Import"
        variant="danger"
      />
    </div>
  );
}

// --- AI Integration section ---

function AIIntegrationSection() {
  const db = useDb();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [savedProxy, setSavedProxy] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getSetting(db, "anthropic_api_key"),
      getSetting(db, "anthropic_proxy_url"),
    ]).then(([key, url]) => {
      setApiKey(key ?? "");
      setProxyUrl(url ?? "");
      setSavedKey(key ?? "");
      setSavedProxy(url ?? "");
      setLoaded(true);
    });
  }, [db]);

  const hasChanges = apiKey !== savedKey || proxyUrl !== savedProxy;

  async function handleSave() {
    if (apiKey !== savedKey) {
      await setSetting(db, "anthropic_api_key", apiKey);
      setSavedKey(apiKey);
    }
    if (proxyUrl !== savedProxy) {
      await setSetting(db, "anthropic_proxy_url", proxyUrl);
      setSavedProxy(proxyUrl);
    }
    toast("Settings saved");
  }

  if (!loaded) return null;

  return (
    <section className="bg-surface rounded-xl border border-border p-4 mb-4">
      <h2 className="text-sm font-bold mb-3">AI Integration</h2>
      <p className="text-xs text-text-muted mb-3">
        Used for PDF statement import. Your API key is stored locally and never sent to any server except Anthropic's API.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Anthropic API Key
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Proxy URL
          </label>
          <Input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://api.anthropic.com (default)"
          />
          <p className="text-[10px] text-text-light mt-1">
            Optional. Only set this if you use a custom proxy. Leave empty to call Anthropic directly.
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
          Save
        </Button>
      </div>
    </section>
  );
}

// --- Categories section ---

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
        {/* Color swatch — click to toggle palette */}
        <button
          type="button"
          onClick={() => setShowColors(!showColors)}
          className="w-5 h-5 rounded-full shrink-0 cursor-pointer ring-1 ring-border transition-shadow hover:ring-accent"
          style={{ backgroundColor: color }}
          title="Change color"
        />
        {/* Name input */}
        <input
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-light min-w-0"
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        />
        {/* Parent select */}
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
        {/* Actions */}
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
      {/* Color palette — progressive disclosure */}
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
  const [expanded, setExpanded] = useState(true);
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
        {/* Expand chevron for parents with children */}
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
      {/* Children — progressive disclosure */}
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

function CategoryGroup({
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
  const [expanded, setExpanded] = useState(true);
  const parents = cats.filter((c) => !c.parent_id);
  const parentOptions = allCategories
    .filter((c) => !c.parent_id && (isIncome ? c : !c))
    .filter((c) => cats.some((gc) => gc.id === c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="mb-3 last:mb-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-1 cursor-pointer group"
      >
        <ChevronIcon expanded={expanded} className="text-text-light" />
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-text-light">{cats.length}</span>
      </button>

      {expanded && (
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
          {/* Inline add — progressive disclosure */}
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
      )}
    </div>
  );
}

function CategoriesSection() {
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
    <section className="bg-surface rounded-xl border border-border p-4 mb-4">
      <h2 className="text-sm font-bold mb-3">Categories</h2>

      {categories.length === 0 ? (
        <p className="text-sm text-text-light">No categories</p>
      ) : (
        <>
          <CategoryGroup
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
          <CategoryGroup
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
        </>
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
    </section>
  );
}
