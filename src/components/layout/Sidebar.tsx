import { Link, useLocation } from "@tanstack/react-router";
import { useTheme } from "../../hooks/useTheme.ts";

const navItems = [
  { to: "/", label: "Cashflow", icon: CashflowIcon },
  { to: "/recurring", label: "Recurring", icon: RecurringIcon },
  { to: "/overview", label: "Overview", icon: OverviewIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function Sidebar() {
  const { isDark } = useTheme();
  const logoSrc = isDark ? "/meta-media/logo-square-darkmode.svg" : "/meta-media/logo-square-lightmode.svg";

  return (
    <aside className="hidden md:flex flex-col w-56 border-r border-border bg-surface h-screen sticky top-0">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={logoSrc} alt="" className="w-7 h-7" />
          <h1 className="text-lg font-bold text-primary">Cactus Money</h1>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}) {
  const { pathname } = useLocation();
  const isActive = to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? "bg-accent/10 text-accent"
          : "text-text-muted hover:bg-surface-alt hover:text-text"
      }`}
    >
      <Icon className="w-5 h-5" />
      {label}
    </Link>
  );
}

export function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-surface/95 backdrop-blur-md border-t border-border z-40 flex safe-bottom">
      {navItems.map((item) => (
        <MobileNavItem key={item.to} {...item} />
      ))}
    </nav>
  );
}

function MobileNavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}) {
  const { pathname } = useLocation();
  const isActive = to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${
        isActive ? "text-accent" : "text-text-muted active:text-text"
      }`}
    >
      {isActive && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent" />
      )}
      <Icon className={`w-5 h-5 transition-transform ${isActive ? "scale-105" : ""}`} />
      {label}
    </Link>
  );
}

// Icons
function CashflowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function OverviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 5 5-9" />
    </svg>
  );
}

function RecurringIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6" />
      <path d="M2.5 22v-6h6" />
      <path d="M21.34 15.57A10 10 0 0 1 5.67 19.74l-3.17-2.74" />
      <path d="M2.66 8.43A10 10 0 0 1 18.33 4.26l3.17 2.74" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
