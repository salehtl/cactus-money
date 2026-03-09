import { useCallback, useEffect, useRef, useState } from "react";
import { useDb } from "@/context/DbContext";
import { getSetting, setSetting } from "@/db/queries/settings";
import { emitDbEvent } from "@/lib/db-events";
import { changelogEntries, latestVersion } from "@/lib/changelog";

const SETTINGS_KEY = "last_seen_version";

export function useChangelog() {
  const db = useDb();
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    getSetting(db, SETTINGS_KEY).then((val) => {
      if (runId.current === id) {
        setLastSeen(val);
        setLoaded(true);
      }
    });
    return () => { runId.current++; };
  }, [db]);

  const hasNew = loaded && lastSeen !== latestVersion;

  const markSeen = useCallback(async () => {
    await setSetting(db, SETTINGS_KEY, latestVersion);
    setLastSeen(latestVersion);
    emitDbEvent("settings-changed");
  }, [db]);

  return { entries: changelogEntries, latestVersion, hasNew, markSeen };
}
