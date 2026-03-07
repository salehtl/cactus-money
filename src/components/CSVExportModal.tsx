import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal.tsx";
import { Button } from "./ui/Button.tsx";
import { DatePicker } from "./ui/Calendar.tsx";
import { useDb } from "../context/DbContext.tsx";
import { useToast } from "./ui/Toast.tsx";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import {
  exportCSV,
  downloadFile,
  CSV_COLUMNS,
  DEFAULT_CSV_OPTIONS,
  type CSVExportOptions,
  type CSVColumnKey,
} from "../lib/export.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  onExported?: () => void;
}

export function CSVExportModal({ open, onClose, onExported }: Props) {
  const db = useDb();
  const { toast } = useToast();
  const [options, setOptions] = useState<CSVExportOptions>(DEFAULT_CSV_OPTIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    let active = true;
    getSetting(db, "csv_export_prefs").then((raw) => {
      if (!active) return;
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Partial<CSVExportOptions>;
          setOptions({ ...DEFAULT_CSV_OPTIONS, ...saved });
        } catch {
          /* ignore bad JSON */
        }
      }
      setLoaded(true);
    });
    return () => { active = false; };
  }, [db, open]);

  function toggleColumn(key: CSVColumnKey) {
    setOptions((prev) => {
      const cols = prev.columns.includes(key)
        ? prev.columns.filter((c) => c !== key)
        : [...prev.columns, key];
      return { ...prev, columns: cols };
    });
  }

  async function handleExport() {
    if (options.columns.length === 0) {
      toast("Select at least one column", "error");
      return;
    }
    try {
      await setSetting(db, "csv_export_prefs", JSON.stringify(options));

      const csv = await exportCSV(db, options);
      downloadFile(
        csv,
        `transactions-${new Date().toISOString().split("T")[0]}.csv`,
        "text/csv"
      );
      toast("CSV exported successfully");
      onExported?.();
      onClose();
    } catch {
      toast("Export failed", "error");
    }
  }

  if (!loaded) return null;

  return (
    <Modal open={open} onClose={onClose} title="Export CSV">
      <div className="space-y-5">
        {/* Columns */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            Columns
          </label>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            {CSV_COLUMNS.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.columns.includes(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="rounded"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            Transaction Type
          </label>
          <div className="flex gap-1">
            {(["all", "income", "expense"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOptions((prev) => ({ ...prev, type: t }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                  options.type === t
                    ? "bg-accent text-white"
                    : "bg-surface-alt text-text-muted hover:text-text"
                }`}
              >
                {t === "all" ? "All" : t === "income" ? "Income" : "Expense"}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            Date Range
          </label>
          <div className="flex items-center gap-2">
            <DatePicker
              value={options.dateFrom ?? ""}
              onChange={(date) =>
                setOptions((prev) => ({ ...prev, dateFrom: date || undefined }))
              }
              placeholder="Start date"
              className="flex-1"
            />
            <span className="text-xs text-text-light">to</span>
            <DatePicker
              value={options.dateTo ?? ""}
              onChange={(date) =>
                setOptions((prev) => ({ ...prev, dateTo: date || undefined }))
              }
              placeholder="End date"
              min={options.dateFrom}
              className="flex-1"
            />
          </div>
          <p className="text-[10px] text-text-light mt-1">
            Leave empty for all dates
          </p>
        </div>

        {/* Sort order */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">
            Sort Order
          </label>
          <div className="flex gap-1">
            {(["desc", "asc"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setOptions((prev) => ({ ...prev, sortOrder: s }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                  options.sortOrder === s
                    ? "bg-accent text-white"
                    : "bg-surface-alt text-text-muted hover:text-text"
                }`}
              >
                {s === "desc" ? "Newest first" : "Oldest first"}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleExport} disabled={options.columns.length === 0}>
            Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}
