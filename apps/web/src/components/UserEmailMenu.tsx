import { ChevronDown, LogOut } from "lucide-react";
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

export function UserEmailMenu({ user }: { user: User }) {
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
    <div className="relative">
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
          "focus-ring flex max-w-[320px] items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-1.5 transition-colors hover:bg-slate-50",
          open && "bg-slate-50",
        )}
      >
        <Avatar user={user} />
        <span className="hidden truncate text-sm font-semibold text-ink sm:block">{user.email}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
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
          className="absolute top-full right-0 z-40 mt-1.5 w-44 animate-pop-in rounded-lg border bg-surface p-1 shadow-pop"
        >
          <button
            type="button"
            ref={itemRef}
            role="menuitem"
            disabled={signingOut}
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-slate-700 outline-none hover:bg-slate-50 focus-visible:bg-slate-100 disabled:opacity-60"
          >
            <LogOut className="size-4 text-muted" aria-hidden />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
