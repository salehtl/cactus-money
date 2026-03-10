import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { useDb } from "../context/DbContext.tsx";
import { useCategories } from "../hooks/useCategories.ts";
import { exportJSON, downloadFile } from "../lib/export.ts";
import { CSVExportModal } from "../components/CSVExportModal.tsx";
import { importJSON } from "../lib/import.ts";
import {
  isFileSystemAccessSupported,
  pickDirectory,
  getStoredDirectory,
  autoExport,
} from "../lib/fs-sync.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { getSeedSQL } from "../db/seed.ts";
import type { ProviderId } from "../lib/pdf-import/llm-provider.ts";
import {
  DEFAULT_PROVIDER,
  PROVIDER_MODELS,
  PROVIDER_DEFAULTS,
  PROVIDER_LABELS,
  PROVIDER_KEY_PLACEHOLDERS,
  PROVIDER_RATE_LIMIT_URLS,
  getModelLabel,
} from "../lib/pdf-import/providers/index.ts";
import { emitDbEvent } from "../lib/db-events.ts";
import { useTheme } from "../hooks/useTheme.ts";
import { useChangelog } from "@/hooks/useChangelog";
import { ChangelogModal } from "@/components/changelog/ChangelogModal";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const db = useDb();
  const { toast } = useToast();

  const [lastExport, setLastExport] = useState<string | null>(null);
  const [hasDir, setHasDir] = useState(false);
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importData, setImportData] = useState<string | null>(null);
  const [showCSVExport, setShowCSVExport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const { entries, latestVersion, hasNew, dismissed, markSeen, setDismissNotifications } = useChangelog();

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

  async function handleClearAllData() {
    try {
      await db.exec("DELETE FROM transaction_tags;");
      await db.exec("DELETE FROM tags;");
      await db.exec("DELETE FROM transactions;");
      await db.exec("DELETE FROM recurring_transactions;");
      await db.exec("DELETE FROM budgets;");
      await db.exec("DELETE FROM categories;");
      await db.exec("DELETE FROM settings;");
      // Re-seed default categories
      const seedStatements = getSeedSQL().split("\n").filter(Boolean);
      for (const stmt of seedStatements) {
        await db.exec(stmt);
      }
      emitDbEvent("transactions-changed");
      emitDbEvent("categories-changed");
      emitDbEvent("recurring-changed");
      emitDbEvent("settings-changed");
      emitDbEvent("tags-changed");
      setLastExport(null);
      setAutoExportEnabled(false);
      toast("All data cleared");
    } catch {
      toast("Failed to clear data", "error");
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />

      {/* Appearance */}
      <AppearanceSection />

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
            <Button variant="secondary" size="sm" onClick={() => setShowCSVExport(true)}>
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

      {/* Categories link */}
      <CategoriesLink />

      {/* About */}
      <section className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold mb-3">About</h2>
        <div className="space-y-3">
          <button
            onClick={() => setShowChangelog(true)}
            className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-alt transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v4l3 3" />
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  What's New
                  {hasNew && (
                    <span className="inline-block w-2 h-2 rounded-full bg-accent" />
                  )}
                </div>
                <p className="text-xs text-text-muted">v{latestVersion} — View changelog</p>
              </div>
            </div>
            <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <div className="space-y-1.5 text-xs text-text-muted px-1">
            <p>Storage: {db.storageType.toUpperCase()}</p>
            <p>Currency: AED (UAE Dirham)</p>
            <p>All data stored locally on this device.</p>
          </div>
        </div>
      </section>

      <ChangelogModal
        open={showChangelog}
        onClose={() => {
          setShowChangelog(false);
          markSeen();
        }}
        entries={entries}
        dismissed={dismissed}
        onDismissChange={setDismissNotifications}
      />

      <CSVExportModal
        open={showCSVExport}
        onClose={() => setShowCSVExport(false)}
        onExported={async () => {
          const now = new Date().toISOString();
          await setSetting(db, "last_export", now);
          setLastExport(now);
        }}
      />

      {/* Danger Zone */}
      <section className="bg-surface rounded-xl border border-danger/30 p-4 mt-6">
        <h2 className="text-sm font-bold text-danger mb-1">Danger Zone</h2>
        <p className="text-xs text-text-muted mb-3">
          Permanently delete all transactions, categories, tags, and settings. Default categories will be restored.
        </p>
        <Button variant="danger" size="sm" onClick={() => setShowClearConfirm(true)}>
          Clear All Data
        </Button>
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

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearAllData}
        title="Clear All Data"
        message="This will permanently delete ALL your data — transactions, categories, tags, budgets, and settings. Default categories will be restored. This cannot be undone."
        confirmLabel="Clear Everything"
        variant="danger"
      />
    </div>
  );
}

// --- Appearance section ---

function AppearanceSection() {
  const { preference, setPreference } = useTheme();

  return (
    <section className="bg-surface rounded-xl border border-border p-4 mb-4">
      <h2 className="text-sm font-bold mb-3">Appearance</h2>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-text-muted">Choose your preferred theme</p>
        </div>
        <select
          value={preference}
          onChange={(e) => setPreference(e.target.value as "light" | "dark" | "system")}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent cursor-pointer"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </div>
    </section>
  );
}

// --- AI Integration section ---

const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "gemini", "custom"];

function AIIntegrationSection() {
  const db = useDb();
  const { toast } = useToast();
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState({ provider: DEFAULT_PROVIDER, apiKey: "", model: "", baseUrl: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // Fetch new + old keys in one batch to avoid sequential round-trips on migration
      const [p, key, m, url, oldKey, oldProxy, oldModel] = await Promise.all([
        getSetting(db, "llm_provider"),
        getSetting(db, "llm_api_key"),
        getSetting(db, "llm_model"),
        getSetting(db, "llm_base_url"),
        getSetting(db, "anthropic_api_key"),
        getSetting(db, "anthropic_proxy_url"),
        getSetting(db, "anthropic_model"),
      ]);

      // Migration: if new keys don't exist but old anthropic keys do, migrate
      if (!p && oldKey) {
        const state = { provider: DEFAULT_PROVIDER, apiKey: oldKey, model: oldModel || "", baseUrl: oldProxy || "" };
        setProvider(state.provider);
        setApiKey(state.apiKey);
        setModel(state.model);
        setBaseUrl(state.baseUrl);
        setSaved(state);
        await Promise.all([
          setSetting(db, "llm_provider", DEFAULT_PROVIDER),
          setSetting(db, "llm_api_key", oldKey),
          setSetting(db, "llm_model", state.model),
          setSetting(db, "llm_base_url", state.baseUrl),
        ]);
        setLoaded(true);
        return;
      }

      const state = {
        provider: (p || DEFAULT_PROVIDER) as ProviderId,
        apiKey: key ?? "",
        model: m ?? "",
        baseUrl: url ?? "",
      };
      setProvider(state.provider);
      setApiKey(state.apiKey);
      setModel(state.model);
      setBaseUrl(state.baseUrl);
      setSaved(state);
      setLoaded(true);
    })();
  }, [db]);

  const hasChanges = provider !== saved.provider || apiKey !== saved.apiKey || model !== saved.model || baseUrl !== saved.baseUrl;
  const models = PROVIDER_MODELS[provider];
  const isCustom = provider === "custom";
  const effectiveModel = model || PROVIDER_DEFAULTS[provider];

  function handleProviderChange(newProvider: ProviderId) {
    setProvider(newProvider);
    setModel(PROVIDER_DEFAULTS[newProvider]);
    setApiKey("");
    setBaseUrl("");
  }

  async function handleSave() {
    await Promise.all([
      setSetting(db, "llm_provider", provider),
      setSetting(db, "llm_api_key", apiKey),
      setSetting(db, "llm_model", effectiveModel),
      setSetting(db, "llm_base_url", baseUrl),
    ]);
    setSaved({ provider, apiKey, model: effectiveModel, baseUrl });
    toast("Settings saved");
  }

  if (!loaded) return null;

  const providerName = PROVIDER_LABELS[provider];

  return (
    <section className="bg-surface rounded-xl border border-border p-4 mb-4">
      <h2 className="text-sm font-bold mb-3">AI Integration</h2>
      <p className="text-xs text-text-muted mb-3">
        Used for PDF statement import. Your API key is stored locally{!isCustom && ` and never sent to any server except ${providerName}'s API`}.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Provider
          </label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent cursor-pointer"
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            API Key
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={PROVIDER_KEY_PLACEHOLDERS[provider]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Model
          </label>
          {isCustom ? (
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. llama3.2-vision"
            />
          ) : (
            <select
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.description}
                </option>
              ))}
            </select>
          )}
          {provider !== "custom" && (
            <a
              href={PROVIDER_RATE_LIMIT_URLS[provider]}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline mt-1"
            >
              View {providerName} rate limits for {getModelLabel(provider, effectiveModel)}
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Base URL
          </label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={isCustom ? "http://localhost:11434/v1 (required)" : "Optional — leave empty for default"}
          />
          <p className="text-[10px] text-text-light mt-1">
            {isCustom
              ? "Required. The OpenAI-compatible API endpoint of your self-hosted model."
              : "Optional. Only set this if you use a custom proxy."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
            Save
          </Button>
          {saved.apiKey && (
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await setSetting(db, "llm_api_key", "");
                setApiKey("");
                setSaved((s) => ({ ...s, apiKey: "" }));
                toast("API key cleared");
              }}
            >
              Clear Key
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// --- Categories link ---

function CategoriesLink() {
  const { expenseCategories, incomeCategories } = useCategories();

  return (
    <section className="bg-surface rounded-xl border border-border p-4 mb-4">
      <h2 className="text-sm font-bold mb-3">Categories</h2>
      <Link
        to="/categories"
        className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-alt transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h6v6H4z" />
              <path d="M14 4h6v6h-6z" />
              <path d="M4 14h6v6H4z" />
              <path d="M14 14h6v6h-6z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium">Manage Categories</p>
            <p className="text-xs text-text-muted">{expenseCategories.length} expense, {incomeCategories.length} income</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Link>
    </section>
  );
}
