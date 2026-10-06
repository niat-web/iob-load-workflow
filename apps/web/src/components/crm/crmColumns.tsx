import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight, CircleStop, ClipboardCheck, Copy, Eye, RotateCcw, ScrollText, Trash2 } from "lucide-react";
import type { CrmDealRow } from "../../types/api";
import { formatDateTime, formatNumber } from "../../utils/format";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { ProgressBar } from "../ProgressBar";
import { StatusBadge } from "../StatusBadge";
import { TruncatedText } from "../TruncatedText";
import { Button } from "../ui/Button";
import { linkClass } from "../ui/styles";

export interface CrmColumnHandlers {
  offset: number;
  onViewDetails: (row: CrmDealRow) => void;
  onRetry: (row: CrmDealRow) => void;
  onCopyLink: (row: CrmDealRow) => void;
  onViewLogs: (row: CrmDealRow) => void;
  onReviewApproval: (row: CrmDealRow) => void;
  onStop: (row: CrmDealRow) => void;
  onDelete: (row: CrmDealRow) => void;
}

const iconClass = "size-4";

function actionItems(row: CrmDealRow, h: CrmColumnHandlers): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  if (row.awaitingApproval) {
    items.push({
      key: "approve",
      label: "Review & Approve",
      icon: <ClipboardCheck className={iconClass} aria-hidden />,
      onSelect: () => h.onReviewApproval(row),
    });
  }
  items.push({
    key: "details",
    label: "View Details",
    icon: <Eye className={iconClass} aria-hidden />,
    onSelect: () => h.onViewDetails(row),
  });
  if (row.canRetry) {
    items.push({
      key: "retry",
      label: "Retry Failed Step",
      icon: <RotateCcw className={iconClass} aria-hidden />,
      onSelect: () => h.onRetry(row),
    });
  }
  if (row.publicLinkUrl) {
    items.push({
      key: "copy",
      label: "Copy Public Link",
      icon: <Copy className={iconClass} aria-hidden />,
      onSelect: () => h.onCopyLink(row),
    });
  }
  items.push({
    key: "logs",
    label: "View Logs",
    icon: <ScrollText className={iconClass} aria-hidden />,
    onSelect: () => h.onViewLogs(row),
  });
  if (row.canStop) {
    items.push({
      key: "stop",
      label: "Stop",
      icon: <CircleStop className={iconClass} aria-hidden />,
      onSelect: () => h.onStop(row),
    });
  }
  if (row.canDelete) {
    items.push({
      key: "delete",
      label: "Delete",
      icon: <Trash2 className={iconClass} aria-hidden />,
      danger: true,
      onSelect: () => h.onDelete(row),
    });
  }
  return items;
}

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

export function buildCrmColumns(h: CrmColumnHandlers): ColumnDef<CrmDealRow>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{h.offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "hubspotDealId",
      header: "Deal ID",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-bold text-ink tabular-nums">{row.original.hubspotDealId}</span>
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
      id: "progress",
      header: "Progress",
      cell: ({ row }) => (
        <ProgressBar value={row.original.progressPercent} label={`Progress for deal ${row.original.hubspotDealId}`} />
      ),
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
    {
      id: "actions",
      header: "Action",
      cell: ({ row }) => (
        <span className="flex items-center justify-end gap-2">
          {row.original.awaitingApproval && (
            <Button size="sm" onClick={() => h.onReviewApproval(row.original)}>
              Review
            </Button>
          )}
          <ActionMenu label={`Actions for deal ${row.original.hubspotDealId}`} items={actionItems(row.original, h)} />
        </span>
      ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
  ];
}
