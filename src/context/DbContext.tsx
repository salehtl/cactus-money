import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { DbClient } from "../db/client.ts";
import { processRecurringRules } from "../db/queries/recurring.ts";
import { getToday, setAppTimezone, DEFAULT_TIMEZONE } from "../lib/format.ts";
import { getSetting } from "../db/queries/settings.ts";
import { emitDbEvent } from "../lib/db-events.ts";

const DbContext = createContext<DbClient | null>(null);

const client = new DbClient();

export function DbProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedulerRan = useRef(false);

  useEffect(() => {
    client
      .waitReady()
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ready || schedulerRan.current) return;
    schedulerRan.current = true;
    // Load timezone from settings before running scheduler
    getSetting(client, "timezone")
      .then((tz) => {
        if (tz) setAppTimezone(tz);
        return processRecurringRules(client, getToday());
      })
      .then((count) => {
        if (count > 0) {
          emitDbEvent("transactions-changed");
          emitDbEvent("recurring-changed");
        }
      })
      .catch((err) => {
        console.error("[recurring scheduler] failed:", err);
      });
  }, [ready]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center p-8">
          <h1 className="text-xl font-bold text-danger mb-2">Database Error</h1>
          <p className="text-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">Loading database...</p>
        </div>
      </div>
    );
  }

  return <DbContext.Provider value={client}>{children}</DbContext.Provider>;
}

export function useDb(): DbClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb must be used within DbProvider");
  return ctx;
}
