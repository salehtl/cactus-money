import { useEffect, useRef } from "react";
import { useDb } from "../context/DbContext.tsx";
import { onDbEvent, emitDbEvent } from "../lib/db-events.ts";
import { autoExport } from "../lib/fs-sync.ts";
import { getSetting, setSetting } from "../db/queries/settings.ts";

export function useAutoExport() {
  const db = useDb();
  const enabledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep enabledRef in sync with the DB setting
  useEffect(() => {
    getSetting(db, "auto_export").then((v) => {
      enabledRef.current = v === "true";
    });
    return onDbEvent("settings-changed", () => {
      getSetting(db, "auto_export").then((v) => {
        enabledRef.current = v === "true";
      });
    });
  }, [db]);

  // Trigger export on any data change — debounced to coalesce rapid bursts
  useEffect(() => {
    function triggerExport() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (!enabledRef.current || inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          const success = await autoExport(db);
          if (success) {
            await setSetting(db, "last_export", new Date().toISOString());
            emitDbEvent("settings-changed");
          }
        } finally {
          inFlightRef.current = false;
        }
      }, 1000);
    }

    const unsubs = [
      onDbEvent("transactions-changed", triggerExport),
      onDbEvent("categories-changed", triggerExport),
      onDbEvent("recurring-changed", triggerExport),
    ];
    return () => {
      unsubs.forEach((u) => u());
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [db]);
}
