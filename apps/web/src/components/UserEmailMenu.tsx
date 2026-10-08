import { ChevronDown, ChevronUp, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { useDismiss } from "../hooks/useDismiss";
import type { User } from "../types/api";
import { cn } from "../utils/cn";
import { initials } from "../utils/format";

function Avatar({ user }: { user: User }) {
  const [failed, setFailed] = useState(false);
  if (user.picture && !failed) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-line"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
    >
      {initials(user.name, user.email)}
    </span>
  );
}

export function UserEmailMenu({ user, variant = "compact" }: { user: User; variant?: "compact" | "sidebar" }) {
  const sidebar = variant === "sidebar";
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useDismiss(open, () => setOpen(false), [triggerRef, menuRef]);

  useEffect(() => {
    if (open) itemRef.current?.focus();
  }, [open]);

  const handleLogout = async () => {
    setSigningOut(true);
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className={cn("relative", sidebar && "w-full")}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.email}`}
        className={cn(
          "focus-ring flex items-center gap-2.5 rounded-lg transition-colors hover:bg-slate-50",
          sidebar ? "w-full px-2.5 py-2 text-left" : "max-w-[320px] py-1.5 pr-2 pl-1.5",
          open && "bg-slate-50",
        )}
      >
        <Avatar user={user} />
        {sidebar ? (
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-ink">{user.name || user.email}</span>
            <span className="truncate text-xs text-muted">{user.email}</span>
          </span>
        ) : (
          <span className="hidden truncate text-sm font-semibold text-ink sm:block">{user.email}</span>
        )}
        {sidebar ? (
          <ChevronUp className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
        ) : (
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Account"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
          className={cn(
            "absolute z-40 animate-pop-in rounded-lg border bg-surface p-1 shadow-pop",
            sidebar ? "right-0 bottom-full left-0 mb-1.5" : "top-full right-0 mt-1.5 w-44",
          )}
        >
          <button
            type="button"
            ref={itemRef}
            role="menuitem"
            disabled={signingOut}
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-red-600 outline-none hover:bg-red-50 focus-visible:bg-red-50 disabled:opacity-60"
          >
            <LogOut className="size-4 text-red-600" aria-hidden />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
