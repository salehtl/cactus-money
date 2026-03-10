import { useCallback, useEffect, useRef, useState } from "react";
import { useDb } from "@/context/DbContext";
import { getSetting, setSetting } from "@/db/queries/settings";
import { changelogEntries, latestVersion } from "@/lib/changelog";

const SETTINGS_KEY = "last_seen_version";
const DISMISSED_KEY = "changelog_dismissed";

export function useChangelog() {
  const db = useDb();
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    Promise.all([
      getSetting(db, SETTINGS_KEY),
      getSetting(db, DISMISSED_KEY),
    ]).then(([lastSeenVal, dismissedVal]) => {
      if (runId.current === id) {
        setLastSeen(lastSeenVal ?? null);
        setDismissed(dismissedVal === "true");
        setLoaded(true);
      }
    });
    return () => { runId.current++; };
  }, [db]);

  const hasNew = loaded && !dismissed && lastSeen !== latestVersion;

  const markSeen = useCallback(async () => {
    await setSetting(db, SETTINGS_KEY, latestVersion);
    setLastSeen(latestVersion);
  }, [db]);

  const setDismissNotifications = useCallback(async (value: boolean) => {
    await setSetting(db, DISMISSED_KEY, value ? "true" : "false");
    setDismissed(value);
  }, [db]);

  return { entries: changelogEntries, latestVersion, hasNew, dismissed, markSeen, setDismissNotifications };
}
