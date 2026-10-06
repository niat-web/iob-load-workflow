import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";
import type { PsmAction, PsmJobRow } from "../../types/api";
import { formatDateTime, formatNumber } from "../../utils/format";
import { StatusBadge } from "../StatusBadge";
import { TruncatedText } from "../TruncatedText";
import { Button, buttonClass, type ButtonVariant } from "../ui/Button";

const ACTIONS: Record<Exclude<PsmAction, "NONE">, { label: string; variant: ButtonVariant }> = {
  OPEN_REVIEW: { label: "Open Review", variant: "primary" },
  CONTINUE_REVIEW: { label: "Continue Review", variant: "primary" },
  VIEW_POOL: { label: "View Pool", variant: "secondary" },
};

function ReviewAction({ row, backTo }: { row: PsmJobRow; backTo: string }) {
  if (row.action === "NONE") {
    return (
      <Button size="sm" variant="secondary" disabled className="w-32">
        Processing
      </Button>
    );
  }
  const action = ACTIONS[row.action] ?? ACTIONS.VIEW_POOL;
  return (
    <Link
      to={`/psm/jobs/${encodeURIComponent(row.id)}/review`}
      state={{ backTo }}
      className={buttonClass(action.variant, "sm", "w-32")}
      aria-label={`${action.label}: ${row.companyName} – ${row.jobRole}`}
    >
      {action.label}
    </Link>
  );
}

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

export function buildPsmJobColumns(offset: number, backTo: string): ColumnDef<PsmJobRow>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "hubspotDealId",
      header: "Deal ID",
      cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.hubspotDealId}</span>,
    },
    {
      id: "companyName",
      header: "Company",
      cell: ({ row }) => <TruncatedText value={row.original.companyName} className="max-w-[170px]" />,
    },
    {
      id: "jobRole",
      header: "Job Role",
      cell: ({ row }) => <TruncatedText value={row.original.jobRole} className="max-w-[190px]" />,
    },
    {
      id: "expectedPoolCount",
      header: "Expected Count",
      cell: ({ row }) => formatNumber(row.original.expectedPoolCount),
      meta: numeric,
    },
    {
      id: "appliedCount",
      header: "Applied Count",
      cell: ({ row }) => formatNumber(row.original.appliedCount),
      meta: numeric,
    },
    {
      id: "applicationWindow",
      header: "Application Window",
      cell: ({ row }) => <StatusBadge chip={row.original.applicationWindow} />,
    },
    {
      id: "aiStatus",
      header: "AI Analysis Status",
      cell: ({ row }) => <StatusBadge chip={row.original.aiStatus} />,
    },
    {
      id: "priorityStatus",
      header: "Priority Status",
      cell: ({ row }) => <StatusBadge chip={row.original.priorityStatus} />,
    },
    {
      id: "psmStatus",
      header: "PSM Review Status",
      cell: ({ row }) => <StatusBadge chip={row.original.psmStatus} />,
    },
    {
      id: "crmShareStatus",
      header: "CRM Share Status",
      cell: ({ row }) => <StatusBadge chip={row.original.crmShareStatus} />,
    },
    {
      id: "updatedAt",
      header: "Updated At",
      cell: ({ row }) => <span className="text-muted tabular-nums">{formatDateTime(row.original.updatedAt)}</span>,
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => <ReviewAction row={row.original} backTo={backTo} />,
      meta: {
        headerClassName: "sticky right-0 z-20 text-right shadow-[inset_1px_0_0_var(--color-line)]",
        cellClassName: "sticky right-0 bg-surface text-right shadow-[inset_1px_0_0_var(--color-line)] group-hover:bg-slate-50",
      },
    },
  ];
}
