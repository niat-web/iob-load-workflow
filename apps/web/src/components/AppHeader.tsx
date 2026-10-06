import { ChartColumn } from "lucide-react";
import { Link, useLocation } from "react-router";
import { homePathFor } from "../auth/roles";
import type { User } from "../types/api";
import { UserEmailMenu } from "./UserEmailMenu";

function brandFor(user: User, pathname: string) {
  const psm = pathname.startsWith("/psm") || (user.role === "PSM" && !pathname.startsWith("/crm"));
  return psm ? { title: "PSM", subtitle: "Candidate Review" } : { title: "CRM", subtitle: "Deal Tracker" };
}

export function AppHeader({ user }: { user: User }) {
  const { pathname } = useLocation();
  const brand = brandFor(user, pathname);
  return (
    <header className="relative z-30 h-16 shrink-0 border-b border-line bg-surface">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          to={homePathFor(user.role)}
          aria-label={`${brand.title} ${brand.subtitle} home`}
          className="focus-ring flex items-center gap-3 rounded-xl"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white shadow-glow">
            <ChartColumn className="size-5" strokeWidth={2.4} aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold text-ink">{brand.title}</span>
            <span className="text-xs text-muted">{brand.subtitle}</span>
          </span>
        </Link>
        <UserEmailMenu user={user} />
      </div>
    </header>
  );
}
