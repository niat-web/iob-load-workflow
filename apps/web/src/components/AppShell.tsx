import { BriefcaseBusiness, Building2, House, Settings, UsersRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { Role, User } from "../types/api";
import { cn } from "../utils/cn";
import { AppHeader } from "./AppHeader";

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
  { to: "/psm", label: "Candidate Pools", icon: UsersRound, roles: ["PSM", "ADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["CRM", "PSM", "ADMIN"] },
];

export function navItemsFor(role: Role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function SideNav({ user }: { user: User }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 pt-5 pb-5 lg:flex">
      <nav aria-label="Main" className="flex flex-col gap-1">
        {navItemsFor(user.role).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
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
      <div className="mt-auto border-t border-line" />
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
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <AppHeader user={user} />
      <TopNav user={user} />
      <div className="flex min-h-0 flex-1">
        <SideNav user={user} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
