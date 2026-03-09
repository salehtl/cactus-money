import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";
import type { ChangelogEntry } from "@/lib/changelog";

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
}

export function ChangelogModal({ open, onClose, entries }: ChangelogModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(entries));

  useEffect(() => {
    if (open) setExpanded(defaultExpanded(entries));
  }, [open, entries]);

  const toggle = (version: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="What's New">
      <div className="space-y-2">
        {entries.map((entry) => {
          const isOpen = expanded.has(entry.version);
          return (
            <div key={entry.version} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(entry.version)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-alt transition-colors cursor-pointer"
              >
                <span className="text-sm font-semibold">v{entry.version}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {formatDate(entry.date)}
                  </span>
                  <svg
                    className={`w-4 h-4 text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>
              {isOpen && (
                <ul className="px-3 pb-3 space-y-1">
                  {entry.items.map((item, i) => (
                    <li key={i} className="text-sm text-text-muted flex gap-2">
                      <span className="text-text-light mt-0.5">&bull;</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function defaultExpanded(entries: ChangelogEntry[]): Set<string> {
  return new Set(entries[0] ? [entries[0].version] : []);
}
