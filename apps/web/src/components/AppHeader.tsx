import { Link, useLocation } from "react-router";
import { homePathFor } from "../auth/roles";
import type { User } from "../types/api";
import { UserEmailMenu } from "./UserEmailMenu";
import { LogoMark } from "./LogoMark";

function brandFor(user: User, pathname: string) {
  const psm = pathname.startsWith("/psm") || (user.role === "PSM" && !pathname.startsWith("/crm"));
  return psm ? { title: "PSM", subtitle: "Candidate Review" } : { title: "CRM", subtitle: "Deal Tracker" };
}

export function Brand({ user }: { user: User }) {
  const { pathname } = useLocation();
  const brand = brandFor(user, pathname);
  return (
    <Link
      to={homePathFor(user.role)}
      aria-label={`${brand.title} ${brand.subtitle} home`}
      className="focus-ring flex items-center gap-3 rounded-xl"
    >
      <LogoMark className="size-9 shrink-0 rounded-[10px] shadow-glow" />
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-bold text-ink">{brand.title}</span>
        <span className="text-xs text-muted">{brand.subtitle}</span>
      </span>
    </Link>
  );
}

export function AppHeader({ user }: { user: User }) {
  return (
    <header className="relative z-30 h-14 shrink-0 border-b border-line bg-surface lg:hidden">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        <Brand user={user} />
        <UserEmailMenu user={user} />
      </div>
    </header>
  );
}
