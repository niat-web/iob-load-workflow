import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, Database, LogOut, SlidersHorizontal, UserPlus, UserRound, UsersRound, X, type LucideIcon } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Navigate, NavLink, useNavigate, useParams } from "react-router";
import { useAdminUsers, useCreateUser, useUpdateUser, type UpdateUserInput } from "../api/admin";
import { errorMessage } from "../api/client";
import { useHubspotOwners } from "../api/crm";
import { useAuth } from "../auth/AuthContext";
import { homePathFor } from "../auth/roles";
import { DataTable } from "../components/DataTable";
import { DetailList } from "../components/DetailList";
import { EmptyState } from "../components/EmptyState";
import { HubspotOwnerSelect } from "../components/HubspotOwnerSelect";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/toast-context";
import { BigQueryBrowser } from "../components/settings/BigQueryBrowser";
import { ConfigSection } from "../components/settings/ConfigSection";
import { Button, IconButton } from "../components/ui/Button";
import { cardClass, cellFieldClass, toolbarFieldClass } from "../components/ui/styles";
import { useModalBehavior } from "../hooks/useModalBehavior";
import type { AdminUser, HubspotOwner, Role, User } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, initials } from "../utils/format";

const ROLES: Role[] = ["CRM", "PSM", "ADMIN"];

const ROLE_DETAILS: Record<Role, { label: string; access: string }> = {
  CRM: { label: "CRM", access: "Submit HubSpot deals and follow them through to the public candidate link." },
  PSM: { label: "PSM", access: "Review AI-ranked candidates and submit the final candidate pool." },
  ADMIN: { label: "Admin", access: "Full access to the CRM and PSM screens, and manages users." },
};

const labelClass = "mb-1.5 block text-[13px] font-semibold text-ink";

function RoleSelect({
  id,
  value,
  onChange,
  compact,
  disabled,
  label,
}: {
  id?: string;
  value: Role;
  onChange: (role: Role) => void;
  compact?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Role)}
        className={cn(compact ? cellFieldClass : toolbarFieldClass, "appearance-none pr-8")}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_DETAILS[role].label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}

function OwnOwnerPicker({ user }: { user: User }) {
  const owners = useHubspotOwners();
  const update = useUpdateUser();
  const { signIn } = useAuth();
  const toast = useToast();
  const [choice, setChoice] = useState<string | null>(null);
  const saved = user.hubspotOwner?.id ?? "";
  const value = choice ?? saved;

  const save = () => {
    update.mutate(
      { email: user.email, hubspotOwnerId: value || null },
      {
        onSuccess: ({ user: updated }) => {
          signIn({ ...user, hubspotOwner: updated.hubspotOwner });
          setChoice(null);
          toast.success(updated.hubspotOwner ? `Linked to ${updated.hubspotOwner.name}` : "HubSpot owner removed");
        },
        onError: (err) => toast.error(errorMessage(err, "The HubSpot owner could not be saved.")),
      },
    );
  };

  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 font-normal">
      <HubspotOwnerSelect
        label="Your HubSpot owner"
        value={value}
        onChange={setChoice}
        owners={owners.data?.owners ?? []}
        placeholder={owners.isPending ? "Loading owners…" : "Select your HubSpot owner"}
        className="w-full sm:w-72"
      />
      <Button onClick={save} disabled={value === saved} loading={update.isPending}>
        Save
      </Button>
      {user.hubspotOwner && <span className="text-xs text-muted tabular-nums">Owner ID {user.hubspotOwner.id}</span>}
    </span>
  );
}

interface AddUserDialogProps {
  open: boolean;
  onClose: () => void;
  owners: HubspotOwner[];
  ownersLoading: boolean;
}

function AddUserDialog({ open, onClose, owners, ownersLoading }: AddUserDialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const create = useCreateUser();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("CRM");
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setRole("CRM");
    setOwnerId("");
    setError(null);
  };
  const close = () => {
    if (create.isPending) return;
    reset();
    onClose();
  };
  useModalBehavior(open, panelRef, close, emailRef);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    setError(null);
    create.mutate(
      { email: address, name: name.trim() || undefined, role, hubspotOwnerId: ownerId || undefined },
      {
        onSuccess: ({ user }) => {
          toast.success(`${user.email} added${user.hubspotOwner ? ` · HubSpot owner ${user.hubspotOwner.name}` : ""}`);
          reset();
          onClose();
        },
        onError: (err) => setError(errorMessage(err, "The user could not be added.")),
      },
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" aria-hidden onMouseDown={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="relative w-full max-w-lg animate-pop-in rounded-xl border bg-surface shadow-pop outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              Add user
            </h2>
            <p className="mt-0.5 text-sm text-muted">They can sign in once added.</p>
          </div>
          <IconButton label="Close" className="size-8 border-transparent shadow-none" onClick={close}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-email`} className={labelClass}>
                Email<span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                ref={emailRef}
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="name@company.com"
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                className={toolbarFieldClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-name`} className={labelClass}>
                Name
              </label>
              <input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="From HubSpot if empty"
                autoComplete="off"
                className={toolbarFieldClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-role`} className={labelClass}>
                Role
              </label>
              <RoleSelect id={`${id}-role`} value={role} onChange={setRole} />
            </div>
            <div>
              <label htmlFor={`${id}-owner`} className={labelClass}>
                HubSpot owner
              </label>
              <HubspotOwnerSelect
                id={`${id}-owner`}
                value={ownerId}
                onChange={setOwnerId}
                owners={owners}
                placeholder={ownersLoading ? "Loading owners…" : "Match by email"}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button variant="secondary" onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} icon={<UserPlus className="size-4" aria-hidden />}>
              Add user
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function buildUserColumns({
  currentEmail,
  owners,
  onChange,
}: {
  currentEmail: string;
  owners: HubspotOwner[];
  onChange: (input: UpdateUserInput, what: string) => void;
}): ColumnDef<AdminUser>[] {
  return [
    {
      id: "user",
      header: "User",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-semibold text-ink">
            {row.original.name || row.original.email.split("@")[0]}
            {row.original.email === currentEmail && <StatusBadge label="You" tone="blue" />}
          </span>
          <span className="text-xs text-muted">{row.original.email}</span>
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <div className="w-32">
          <RoleSelect
            compact
            label={`Role for ${row.original.email}`}
            value={row.original.role}
            disabled={row.original.email === currentEmail}
            onChange={(role) => onChange({ email: row.original.email, role }, "role")}
          />
        </div>
      ),
    },
    {
      id: "owner",
      header: "HubSpot Owner",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <HubspotOwnerSelect
            compact
            label={`HubSpot owner for ${row.original.email}`}
            value={row.original.hubspotOwner?.id ?? ""}
            onChange={(ownerId) => onChange({ email: row.original.email, hubspotOwnerId: ownerId || null }, "HubSpot owner")}
            owners={owners}
            placeholder="Not linked"
            className="w-56"
          />
          {row.original.hubspotOwner && (
            <span className="text-xs text-muted tabular-nums">{row.original.hubspotOwner.id}</span>
          )}
        </div>
      ),
    },
    {
      id: "active",
      header: "Access",
      cell: ({ row }) => (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={row.original.isActive}
            disabled={row.original.email === currentEmail}
            onChange={(e) => onChange({ email: row.original.email, isActive: e.target.checked }, e.target.checked ? "access" : "access removal")}
            className="size-4 accent-primary"
          />
          {row.original.isActive ? "Active" : "Inactive"}
        </label>
      ),
    },
    {
      id: "lastLogin",
      header: "Last Sign-in",
      cell: ({ row }) => (
        <span className="text-muted tabular-nums">
          {row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : "Never"}
        </span>
      ),
    },
  ];
}

function UsersSection({ currentEmail }: { currentEmail: string }) {
  const users = useAdminUsers();
  const owners = useHubspotOwners();
  const update = useUpdateUser();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const ownerList = useMemo(() => owners.data?.owners ?? [], [owners.data]);

  const { mutate } = update;
  const change = useCallback(
    (input: UpdateUserInput, what: string) => {
      mutate(input, {
        onSuccess: () => toast.success(`${input.email}: ${what} saved`),
        onError: (err) => toast.error(errorMessage(err, "The change could not be saved.")),
      });
    },
    [mutate, toast],
  );

  const columns = useMemo(
    () => buildUserColumns({ currentEmail, owners: ownerList, onChange: change }),
    [currentEmail, ownerList, change],
  );

  return (
    <section aria-labelledby="users-title" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="users-title" className="text-lg font-bold text-ink">
            Users
          </h2>
          <p className="mt-1 text-sm text-muted">
            Who can sign in, their role and their HubSpot owner. The owner is preselected as CRM owner, Profiling POC
            and ISE when they add a deal.
          </p>
        </div>
        <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
          Add user
        </Button>
      </div>
      <AddUserDialog open={adding} onClose={() => setAdding(false)} owners={ownerList} ownersLoading={owners.isPending} />
      <DataTable
        caption="Users"
        data={users.data?.users}
        columns={columns}
        getRowId={(row) => row.email}
        isLoading={users.isPending}
        isFetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        emptyState={<EmptyState message="No users yet." description="Use Add user to add the first one." />}
      />
    </section>
  );
}

interface SettingsTab {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const SETTINGS_TABS: SettingsTab[] = [
  { to: "/settings", label: "Profile", icon: UserRound },
  { to: "/settings/users", label: "Users", icon: UsersRound, adminOnly: true },
  { to: "/settings/bigquery", label: "BigQuery", icon: Database, adminOnly: true },
  { to: "/settings/config", label: "Config", icon: SlidersHorizontal, adminOnly: true },
];

function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav aria-label="Settings" className="flex flex-wrap gap-1 border-b border-line">
      {SETTINGS_TABS.filter((tab) => isAdmin || !tab.adminOnly).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              "focus-ring -mb-px flex h-11 shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-4 text-sm font-semibold transition-colors",
              isActive ? "border-primary text-primary" : "border-transparent text-muted hover:border-slate-300 hover:text-ink",
            )
          }
        >
          <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function SettingsPage() {
  const { state } = useAuth();
  const { section } = useParams();
  if (state.status !== "authenticated") return null;
  const { user } = state;
  const isAdmin = user.role === "ADMIN";
  const showUsers = section === "users" && isAdmin;
  const showBigQuery = section === "bigquery" && isAdmin;
  const showConfig = section === "config" && isAdmin;
  if (section && !showUsers && !showBigQuery && !showConfig) return <Navigate to="/settings" replace />;

  return (
    <div className="flex min-h-full flex-col gap-6">
      <h1 className="sr-only">Settings</h1>
      <SettingsNav isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        {showUsers ? (
          <UsersSection currentEmail={user.email} />
        ) : showBigQuery ? (
          <BigQueryBrowser />
        ) : showConfig ? (
          <ConfigSection />
        ) : (
          <ProfileSection user={user} />
        )}
      </div>
    </div>
  );
}

function ProfileSection({ user }: { user: User }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const role = ROLE_DETAILS[user.role];
  const isAdmin = user.role === "ADMIN";

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate("/login", { replace: true });
  };

  const ownerValue = isAdmin ? (
    <OwnOwnerPicker user={user} />
  ) : user.hubspotOwner ? (
    `${user.hubspotOwner.name} · ${user.hubspotOwner.id}`
  ) : (
    "Not linked yet. Ask an admin to link your HubSpot owner."
  );

  return (
    <section aria-labelledby="account-title" className={cn(cardClass, "max-w-3xl p-6")}>
      <h2 id="account-title" className="text-lg font-bold text-ink">
        Profile
      </h2>
      <p className="mt-1 text-sm text-muted">
        You sign in with your company Google account.
        {isAdmin ? " As an admin you manage users under Users." : " Roles are managed by an admin."}
      </p>

      <div className="mt-6 flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-base font-semibold text-white"
        >
          {initials(user.name, user.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">{user.name || user.email}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <DetailList
        className="mt-6 border-t pt-6"
        items={[
          { label: "Role", value: <StatusBadge label={role.label} tone="purple" /> },
          { label: "Home page", value: homePathFor(user.role) === "/psm" ? "Candidate Pools" : "Dashboard" },
          { label: "HubSpot owner", value: ownerValue, wide: true },
          { label: "Access", value: role.access, wide: true },
        ]}
      />

      <div className="mt-8 border-t pt-6">
        <Button
          variant="secondary"
          loading={signingOut}
          icon={<LogOut className="size-4" aria-hidden />}
          onClick={() => void handleSignOut()}
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}
