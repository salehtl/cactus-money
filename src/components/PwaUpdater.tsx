import { useState, useEffect, useRef } from "react";

let swRegistration: ServiceWorkerRegistration | null = null;
let lastUpdateCheck = 0;
const UPDATE_COOLDOWN_MS = 5 * 60 * 1000;

/** Trigger a manual SW update check. Returns the promise if initiated, null otherwise. */
export function checkForUpdates(): Promise<void> | null {
  if (!swRegistration) return null;
  lastUpdateCheck = Date.now();
  return swRegistration.update();
}

export function PwaUpdater() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const updateSW = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const runRef = useRef(0);
  const updateFoundRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const run = ++runRef.current;
    const cleanups: (() => void)[] = [];

    import("virtual:pwa-register").then(({ registerSW }) => {
      if (run !== runRef.current) return;
      updateSW.current = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (run !== runRef.current) return;
          updateFoundRef.current = true;
          setNeedRefresh(true);
        },
        onRegistered(registration) {
          if (!registration || run !== runRef.current) return;
          swRegistration = registration;

          const safeUpdate = () => {
            if (updateFoundRef.current) return;
            lastUpdateCheck = Date.now();
            registration.update().catch(() => {});
          };

          // Check for updates every 15 minutes
          const interval = setInterval(safeUpdate, 15 * 60 * 1000);
          // Also check when app returns from background (with cooldown)
          const onVisible = () => {
            if (document.visibilityState !== "visible") return;
            if (updateFoundRef.current) return;
            const now = Date.now();
            if (now - lastUpdateCheck < UPDATE_COOLDOWN_MS) return;
            safeUpdate();
          };
          document.addEventListener("visibilitychange", onVisible);
          cleanups.push(
            () => clearInterval(interval),
            () => document.removeEventListener("visibilitychange", onVisible),
            () => { swRegistration = null; lastUpdateCheck = 0; },
          );
        },
      });
    });
    return () => {
      updateFoundRef.current = false;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  function handleRefresh() {
    if (refreshing || !updateSW.current) return;
    setRefreshing(true);
    updateSW.current(true).catch(() => {
      setRefreshing(false);
    });
  }

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 md:bottom-4 md:left-auto md:translate-x-0 md:right-4 z-50 flex items-center gap-3 bg-primary text-white pl-4 pr-2 py-2 rounded-lg shadow-lg text-sm font-medium animate-slide-up">
      <span>A new version is available</span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer text-xs font-semibold"
      >
        {refreshing ? "Reloading…" : "Refresh"}
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="p-1 rounded-md hover:bg-white/20 transition-colors cursor-pointer"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
