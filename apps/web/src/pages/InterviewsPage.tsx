import type { ColumnDef } from "@tanstack/react-table";
import { Copy, ExternalLink, RefreshCw, SearchX, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useInterviewCompanies } from "../api/interviews";
import { DataTable } from "../components/DataTable";
import { GoogleConnectCard } from "../components/interviews/GoogleConnectCard";
import { EmptyState } from "../components/EmptyState";
import { SearchInput } from "../components/SearchInput";
import { StatusBadge } from "../components/StatusBadge";
import { TruncatedText } from "../components/TruncatedText";
import { IconButton, buttonClass } from "../components/ui/Button";
import { linkClass } from "../components/ui/styles";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import type { InterviewCompany, SharedLinkStatus, Tone } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, formatNumber } from "../utils/format";

const LINK_STATUS: Record<SharedLinkStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "green" },
  EXPIRED: { label: "Expired", tone: "gray" },
  INACTIVE: { label: "Turned off", tone: "red" },
};

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

function buildColumns(copy: (text: string, message?: string) => Promise<boolean>): ColumnDef<InterviewCompany>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "company",
      header: "Company",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          {row.original.companyLogoUrl ? (
            <img src={row.original.companyLogoUrl} alt="" className="size-7 shrink-0 rounded-md border border-line object-contain" />
          ) : (
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-muted">
              {row.original.companyName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <TruncatedText value={row.original.companyName} className="max-w-[220px] font-semibold" />
        </div>
      ),
    },
    {
      id: "role",
      header: "Job Role",
      cell: ({ row }) => <TruncatedText value={row.original.jobRole || "—"} className="max-w-[220px]" />,
    },
    {
      id: "link",
      header: "Shared Profiles Link",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <a href={row.original.url} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "max-w-[260px] truncate")}>
            <span className="truncate">{row.original.url.replace(/^https?:\/\//, "")}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <IconButton label={`Copy the ${row.original.companyName} link`} className="size-8" onClick={() => void copy(row.original.url)}>
            <Copy className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      ),
    },
    {
      id: "status",
      header: "Link",
      cell: ({ row }) => <StatusBadge {...LINK_STATUS[row.original.linkStatus]} />,
    },
    { id: "profiles", header: "Profiles", cell: ({ row }) => formatNumber(row.original.profiles), meta: numeric },
    { id: "meets", header: "Meets", cell: ({ row }) => formatNumber(row.original.meets), meta: numeric },
    { id: "interviewers", header: "Interviewers", cell: ({ row }) => formatNumber(row.original.interviewers), meta: numeric },
    {
      id: "createdAt",
      header: "Shared On",
      cell: ({ row }) => <span className="text-muted tabular-nums">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => (
        <Link to={`/crm/interviews/${row.original.jobId}`} className={buttonClass("secondary", "sm")}>
          <Video className="size-4" aria-hidden />
          Open
        </Link>
      ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
  ];
}

export function InterviewsPage() {
  const companies = useInterviewCompanies();
  const copy = useCopyToClipboard();
  const [search, setSearch] = useState("");
  const columns = useMemo(() => buildColumns(copy), [copy]);
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      companies.data?.items.filter(
        (item) => !term || item.companyName.toLowerCase().includes(term) || item.jobRole.toLowerCase().includes(term),
      ),
    [companies.data, term],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Interviews</h1>
      <GoogleConnectCard returnTo="/crm/interviews" />
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} delay={0} placeholder="Search company or role..." label="Search companies" className="w-full sm:w-80" />
        <IconButton label="Refresh" large className="sm:ml-auto" onClick={() => void companies.refetch()}>
          <RefreshCw className={cn("size-4", companies.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>
      <DataTable
        caption="Shared profiles links by company"
        data={rows}
        columns={columns}
        getRowId={(row) => row.jobId}
        isLoading={companies.isPending}
        isFetching={companies.isFetching}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        emptyState={
          term ? (
            <EmptyState icon={<SearchX strokeWidth={1.6} aria-hidden />} message="No companies match your search." />
          ) : (
            <EmptyState
              icon={<Video strokeWidth={1.6} aria-hidden />}
              message="No shared profiles links yet."
              description="A company appears here once the PSM submits its candidate pool."
            />
          )
        }
      />
    </div>
  );
}
