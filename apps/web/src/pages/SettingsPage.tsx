import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, LogOut, UserPlus } from "lucide-react";
import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
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
import { Button } from "../components/ui/Button";
import { cardClass, cellFieldClass, toolbarFieldClass } from "../components/ui/styles";
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

function AddUserForm({ owners, ownersLoading }: { owners: HubspotOwner[]; ownersLoading: boolean }) {
  const id = useId();
  const create = useCreateUser();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("CRM");
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    create.mutate(
      { email: address, name: name.trim() || undefined, role, hubspotOwnerId: ownerId || undefined },
      {
        onSuccess: ({ user }) => {
          toast.success(`${user.email} added${user.hubspotOwner ? ` · HubSpot owner ${user.hubspotOwner.name}` : ""}`);
          setEmail("");
          setName("");
          setRole("CRM");
          setOwnerId("");
        },
        onError: (err) => setError(errorMessage(err, "The user could not be added.")),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className={cn(cardClass, "p-4")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_auto] xl:items-end">
        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>
            Email<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoComplete="off"
            className={toolbarFieldClass}
          />
        </div>
        <div>
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
        <button
          type="submit"
          disabled={create.isPending}
          className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-sm font-semibold whitespace-nowrap text-white shadow-glow transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UserPlus className="size-4" aria-hidden />
          Add user
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
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
    <section aria-labelledby="users-title" className="space-y-4">
      <div>
        <h2 id="users-title" className="text-lg font-bold text-ink">
          Users
        </h2>
        <p className="mt-1 text-sm text-muted">
          Who can sign in, their role and their HubSpot owner. The owner is preselected as CRM owner, Profiling POC
          and ISE when they add a deal.
        </p>
      </div>
      <AddUserForm owners={ownerList} ownersLoading={owners.isPending} />
      <DataTable
        caption="Users"
        data={users.data?.users}
        columns={columns}
        getRowId={(row) => row.email}
        isLoading={users.isPending}
        isFetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        emptyState={<EmptyState message="No users yet." description="Add the first user above." />}
      />
    </section>
  );
}

export function SettingsPage() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  if (state.status !== "authenticated") return null;
  const { user } = state;
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
    <div className="space-y-6">
      <h1 className="sr-only">Settings</h1>
      <section aria-labelledby="account-title" className={cn(cardClass, "max-w-3xl p-6")}>
        <h2 id="account-title" className="text-lg font-bold text-ink">
          Account
        </h2>
        <p className="mt-1 text-sm text-muted">
          You sign in with your company Microsoft account.
          {isAdmin ? " As an admin you manage users below." : " Roles are managed by an admin."}
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

      {isAdmin && <UsersSection currentEmail={user.email} />}
    </div>
  );
}
