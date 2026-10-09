import { BriefcaseBusiness, Building2, GraduationCap, House, Settings, UsersRound, Video, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { NavLink } from "react-router";
import { useWheelScroll } from "../hooks/useWheelScroll";
import { preloadPage, preloadPagesWhenIdle } from "../pages/pageLoaders";
import type { Role, User } from "../types/api";
import { cn } from "../utils/cn";
import { AppHeader, Brand } from "./AppHeader";
import { UserEmailMenu } from "./UserEmailMenu";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: readonly Role[];
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/crm", label: "Dashboard", icon: House, roles: ["CRM", "ADMIN"], end: true },
  { to: "/crm/deals", label: "Deals", icon: BriefcaseBusiness, roles: ["CRM", "ADMIN"] },
  { to: "/crm/companies", label: "Companies", icon: Building2, roles: ["CRM", "ADMIN"] },
  { to: "/crm/interviews", label: "Interviews", icon: Video, roles: ["CRM", "ADMIN"] },
  { to: "/psm", label: "Candidate Pools", icon: UsersRound, roles: ["PSM", "ADMIN"] },
  { to: "/admin/eligible-pool", label: "Eligible Pool", icon: GraduationCap, roles: ["ADMIN", "POOL_MANAGER"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["CRM", "PSM", "ADMIN", "POOL_MANAGER"] },
];

export function navItemsFor(role: Role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function SideNav({ user }: { user: User }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Brand user={user} />
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-3 pb-4">
        {navItemsFor(user.role).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onMouseEnter={() => preloadPage(to)}
            onFocus={() => preloadPage(to)}
            className={({ isActive }) =>
              cn(
                "focus-ring flex h-11 items-center gap-3 rounded-lg px-3.5 text-[15px] font-medium transition-colors",
                isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-slate-50 hover:text-ink",
              )
            }
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.8} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="shrink-0 border-t border-line p-3">
        <UserEmailMenu user={user} variant="sidebar" />
      </div>
    </aside>
  );
}

function TopNav({ user }: { user: User }) {
  return (
    <nav aria-label="Main" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:hidden">
      {navItemsFor(user.role).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onTouchStart={() => preloadPage(to)}
          onFocus={() => preloadPage(to)}
          className={({ isActive }) =>
            cn(
              "focus-ring flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-slate-50 hover:text-ink",
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => preloadPagesWhenIdle(navItemsFor(user.role).map((item) => item.to)), [user.role]);
  useWheelScroll(rootRef, mainRef);

  return (
    <div ref={rootRef} className="flex h-dvh overflow-hidden bg-canvas">
      <SideNav user={user} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader user={user} />
        <TopNav user={user} />
        <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
