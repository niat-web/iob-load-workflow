import { ArrowLeft, FileText, History, ListChecks, RotateCcw, Rocket, UsersRound, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { errorMessage, hasStatus } from "../api/client";
import { useCrmDeal, useRetryDeal } from "../api/crm";
import { ApprovalDrawer } from "../components/crm/ApprovalDrawer";
import { DealLogsList } from "../components/crm/DealLogsList";
import {
  ApplicationsSection,
  Card,
  CompanyProfileSection,
  DealStatusCard,
  FlowSection,
  JobMetaSection,
  LearningPortalSection,
  LinksSection,
  RecordSection,
  RemindersSection,
  RequirementsSection,
  TimelineSection,
} from "../components/crm/DealSections";
import { DealStudentsTab } from "../components/crm/DealStudentsTab";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/toast-context";
import { Button, buttonClass } from "../components/ui/Button";
import type { CrmDealDetail } from "../types/api";
import { cn } from "../utils/cn";
import { formatNumber } from "../utils/format";

interface DealTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TABS: DealTab[] = [
  { key: "", label: "Deal Details", icon: FileText },
  { key: "students", label: "Students & Access", icon: UsersRound },
  { key: "workflow", label: "Workflow & Timeline", icon: ListChecks },
  { key: "logs", label: "Logs", icon: History },
];

interface BackState {
  from?: string;
}

const dealPath = (jobId: string, tab = "") => `/crm/deals/${encodeURIComponent(jobId)}${tab ? `/${tab}` : ""}`;

function DealTabs({ deal, state }: { deal: CrmDealDetail; state: unknown }) {
  return (
    <nav aria-label="Deal sections" className="flex flex-wrap gap-1 border-b border-line">
      {TABS.map(({ key, label, icon: Icon }) => (
        <NavLink
          key={key || "details"}
          to={dealPath(deal.id, key)}
          state={state}
          replace
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
          {key === "students" && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 tabular-nums">
              {formatNumber(deal.eligibleCount)}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function DetailsTab({ deal }: { deal: CrmDealDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <DealStatusCard deal={deal} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <JobMetaSection deal={deal} />
        </Card>
        <Card>
          <CompanyProfileSection deal={deal} />
        </Card>
      </div>
      <Card>
        <RequirementsSection deal={deal} />
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <ApplicationsSection deal={deal} />
        </Card>
        <Card>
          <LinksSection deal={deal} />
        </Card>
      </div>
    </div>
  );
}

function WorkflowTab({ deal }: { deal: CrmDealDetail }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <FlowSection deal={deal} />
        </Card>
        <Card>
          <LearningPortalSection deal={deal} />
        </Card>
        <Card>
          <RemindersSection deal={deal} />
        </Card>
        <Card>
          <RecordSection deal={deal} />
        </Card>
      </div>
      <Card>
        <TimelineSection deal={deal} />
      </Card>
    </div>
  );
}

function DealHeader({ deal, onBack, onApprove }: { deal: CrmDealDetail; onBack: () => void; onApprove: () => void }) {
  const toast = useToast();
  const retry = useRetryDeal();
  const title = [deal.companyName, deal.jobRole].filter(Boolean).join(" · ") || `Deal ${deal.hubspotDealId}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
        <h1 className="mt-2 truncate text-2xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted tabular-nums">
          Deal {deal.hubspotDealId}
          {deal.learningPortal.jobId ? ` · Job ID ${deal.learningPortal.jobId}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge chip={deal.displayStatus} />
        {deal.awaitingApproval && (
          <Button size="sm" onClick={onApprove}>
            Review & Approve
          </Button>
        )}
        {deal.canRetry && (
          <Button
            size="sm"
            variant="secondary"
            loading={retry.isPending}
            icon={<RotateCcw className="size-4" aria-hidden />}
            onClick={() =>
              retry.mutate(deal.id, {
                onSuccess: () => toast.success(`Retry started for deal ${deal.hubspotDealId}`),
                onError: (err) => toast.error(errorMessage(err, "This step could not be retried.")),
              })
            }
          >
            Retry Failed Step
          </Button>
        )}
        {deal.applicationStartAt && (
          <Link to={`${dealPath(deal.id)}/boost`} className={cn(buttonClass("secondary", "sm"), "gap-2")}>
            <Rocket className="size-4" aria-hidden />
            Boost applications
          </Link>
        )}
      </div>
    </div>
  );
}

export function DealPage() {
  const { jobId = "", tab = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const deal = useCrmDeal(jobId || null);
  const [approving, setApproving] = useState(false);
  const from = (location.state as BackState | null)?.from ?? "/crm/deals";
  const goBack = () => {
    void navigate(from);
  };

  if (!TABS.some((item) => item.key === tab)) return <Navigate to={dealPath(jobId)} replace state={location.state} />;

  if (deal.isPending) return <LoadingSkeleton lines={12} label="Loading deal" />;
  if (deal.isError) {
    if (hasStatus(deal.error, 404)) {
      return (
        <EmptyState
          message="This deal could not be found."
          description="It may have been deleted."
          action={
            <Button variant="secondary" size="sm" onClick={goBack}>
              Back
            </Button>
          }
        />
      );
    }
    return <ErrorState error={deal.error} onRetry={() => void deal.refetch()} retrying={deal.isFetching} />;
  }

  const data = deal.data;
  return (
    <div className="flex flex-col gap-5">
      <DealHeader deal={data} onBack={goBack} onApprove={() => setApproving(true)} />
      <DealTabs deal={data} state={location.state} />
      {tab === "students" ? (
        <DealStudentsTab deal={data} />
      ) : tab === "workflow" ? (
        <WorkflowTab deal={data} />
      ) : tab === "logs" ? (
        <DealLogsList jobId={data.id} />
      ) : (
        <DetailsTab deal={data} />
      )}
      <ApprovalDrawer job={approving ? data : null} onClose={() => setApproving(false)} />
    </div>
  );
}
