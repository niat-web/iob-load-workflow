import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import type { CrmDealRow } from "../../types/api";
import { formatDate, formatDateTime, formatNumber, formatTime, isDateValue } from "../../utils/format";
import { StatusBadge } from "../StatusBadge";
import { TruncatedText } from "../TruncatedText";
import { linkClass } from "../ui/styles";

export interface CrmColumnOptions {
  offset: number;
  from: string;
}

export const dealPagePath = (row: CrmDealRow) => `/crm/deals/${encodeURIComponent(row.id)}`;

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

function Deadline({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">-</span>;
  if (!isDateValue(value)) return <TruncatedText value={value} className="max-w-[160px] text-slate-600" />;
  return (
    <span className="flex flex-col whitespace-nowrap tabular-nums">
      <span className="text-ink">{formatDate(value)}</span>
      <span className="text-xs text-muted">{formatTime(value)}</span>
    </span>
  );
}

export function buildCrmColumns(options: CrmColumnOptions): ColumnDef<CrmDealRow>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{options.offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "hubspotDealId",
      header: "Deal ID",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <Link
            to={dealPagePath(row.original)}
            state={{ from: options.from }}
            className="focus-ring self-start rounded font-bold text-ink tabular-nums hover:text-primary"
          >
            {row.original.hubspotDealId}
          </Link>
          {row.original.flowMode === "STEP_BY_STEP" && <span className="text-xs text-muted">Step by step</span>}
        </span>
      ),
    },
    {
      id: "companyName",
      header: "Company",
      cell: ({ row }) => <TruncatedText value={row.original.companyName} className="max-w-[180px] font-semibold" />,
    },
    {
      id: "jobRole",
      header: "Job Role",
      cell: ({ row }) => <TruncatedText value={row.original.jobRole} className="max-w-[200px] text-slate-600" />,
    },
    {
      id: "expectedPoolCount",
      header: "Expected Pool",
      cell: ({ row }) => formatNumber(row.original.expectedPoolCount),
      meta: numeric,
    },
    {
      id: "appliedCount",
      header: "Applied",
      cell: ({ row }) => formatNumber(row.original.appliedCount),
      meta: numeric,
    },
    {
      id: "deadline",
      header: "Deadline",
      cell: ({ row }) => <Deadline value={row.original.deadline} />,
    },
    {
      id: "currentStep",
      header: "Current Step",
      cell: ({ row }) => <TruncatedText value={row.original.currentStep} className="max-w-[180px] text-muted" />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge chip={row.original.displayStatus} title={row.original.lastError ?? undefined} />
      ),
    },
    {
      id: "publicLink",
      header: "Public Link",
      cell: ({ row }) =>
        row.original.publicLinkUrl ? (
          <a href={row.original.publicLinkUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            View Link
            <ArrowUpRight className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span className="text-muted">-</span>
        ),
    },
    {
      id: "updatedAt",
      header: "Last Updated",
      cell: ({ row }) => <span className="text-muted tabular-nums">{formatDateTime(row.original.updatedAt)}</span>,
    },
  ];
}
