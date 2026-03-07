import { createRootRoute, Outlet } from "@tanstack/react-router";
import { DbProvider } from "../context/DbContext.tsx";
import { ToastProvider } from "../components/ui/Toast.tsx";
import { Sidebar, MobileNav } from "../components/layout/Sidebar.tsx";
import { AdminPanel } from "../components/AdminPanel.tsx";
import { Onboarding } from "../components/Onboarding.tsx";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <DbProvider>
      <ToastProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0 p-4 md:p-6 pb-20 md:pb-6">
            <Outlet />
          </main>
          <MobileNav />
          <AdminPanel />
          <Onboarding />
        </div>
      </ToastProvider>
    </DbProvider>
  );
}
