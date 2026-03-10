import { createRootRoute, Outlet } from "@tanstack/react-router";
import { DbProvider } from "../context/DbContext.tsx";
import { ToastProvider } from "../components/ui/Toast.tsx";
import { Sidebar, MobileNav } from "../components/layout/Sidebar.tsx";
import { AdminPanel } from "../components/AdminPanel.tsx";
import { Onboarding } from "../components/Onboarding.tsx";
import { useChangelog } from "../hooks/useChangelog.ts";
import { PwaUpdater } from "../components/PwaUpdater.tsx";
import { useAutoExport } from "../hooks/useAutoExport.ts";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <DbProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </DbProvider>
  );
}

function AppShell() {
  const { hasNew } = useChangelog();
  useAutoExport();

  return (
    <div className="flex min-h-screen">
      <Sidebar settingsBadge={hasNew} />
      <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 pb-safe md:pb-6">
        <div className="max-w-5xl mx-auto">
          <Outlet />
        </div>
      </main>
      <MobileNav settingsBadge={hasNew} />
      <AdminPanel />
      <Onboarding />
      <PwaUpdater />
    </div>
  );
}
