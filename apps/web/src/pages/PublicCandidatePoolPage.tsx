import type { ColumnDef } from "@tanstack/react-table";
import { Hourglass, Link2Off } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useParams } from "react-router";
import { hasStatus } from "../api/client";
import { publicResumeUrl, usePublicPool } from "../api/public";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { ScoreCell } from "../components/ScoreCell";
import { SkillChips } from "../components/SkillChips";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryStrip, SummaryStripSkeleton } from "../components/SummaryStrip";
import { TruncatedText } from "../components/TruncatedText";
import { cardClass, linkClass } from "../components/ui/styles";
import type { PublicCandidate } from "../types/api";
import { candidateStatusLabel, candidateStatusTone } from "../utils/candidate";
import { DASH, formatNumber, priorityNumber } from "../utils/format";

const numeric = { headerClassName: "text-right", cellClassName: "text-right" };

function buildColumns(token: string): ColumnDef<PublicCandidate>[] {
  return [
    {
      id: "finalPriority",
      header: "Final Priority",
      cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.finalPriority}</span>,
    },
    {
      id: "studentName",
      header: "Student Name",
      cell: ({ row }) => <TruncatedText value={row.original.studentName} className="max-w-[200px] font-semibold" />,
    },
    {
      id: "resume",
      header: "Resume",
      cell: ({ row }) =>
        row.original.hasResume ? (
          <a
            href={publicResumeUrl(token, row.original.ref)}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            View
            <span className="sr-only"> resume of {row.original.studentName} (opens in a new tab)</span>
          </a>
        ) : (
          <span className="text-muted">{DASH}</span>
        ),
    },
    {
      id: "relevantSkills",
      header: "Relevant Skills",
      cell: ({ row }) => <SkillChips skills={row.original.relevantSkills} />,
    },
    {
      id: "resumeScore",
      header: "AI Resume Score",
      cell: ({ row }) => <ScoreCell value={row.original.resumeScore} />,
      meta: numeric,
    },
    {
      id: "gritScore",
      header: "GRIT Score",
      cell: ({ row }) => <ScoreCell value={row.original.gritScore} missingHint="GRIT Data Not Available" />,
      meta: numeric,
    },
    {
      id: "assessmentScore",
      header: "Assessment Score",
      cell: ({ row }) => <ScoreCell value={row.original.assessmentScore} />,
      meta: numeric,
    },
    {
      id: "interviewScore",
      header: "Interview Score",
      cell: ({ row }) => <ScoreCell value={row.original.interviewScore} />,
      meta: numeric,
    },
    {
      id: "overallScore",
      header: "Overall Score",
      cell: ({ row }) => (
        <span className="font-semibold">
          <ScoreCell value={row.original.overallScore} />
        </span>
      ),
      meta: numeric,
    },
    {
      id: "candidateStatus",
      header: "Candidate Status",
      cell: ({ row }) => {
        const status = row.original.candidateStatus;
        return status ? (
          <StatusBadge label={candidateStatusLabel(status) ?? undefined} tone={candidateStatusTone(status)} />
        ) : (
          <span className="text-muted">{DASH}</span>
        );
      },
    },
  ];
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="sr-only">Candidate pool</h1>
        {children}
      </main>
    </div>
  );
}

export function PublicCandidatePoolPage() {
  const { token = "" } = useParams();
  const pool = usePublicPool(token);
  const columns = useMemo(() => buildColumns(token), [token]);
  const candidates = useMemo(
    () =>
      pool.data
        ? pool.data.candidates.toSorted((a, b) => priorityNumber(a.finalPriority) - priorityNumber(b.finalPriority))
        : undefined,
    [pool.data],
  );

  if (!token || hasStatus(pool.error, 404)) {
    return (
      <PublicShell>
        <div className={cardClass}>
          <EmptyState icon={<Link2Off className="size-5" aria-hidden />} message="This link is not valid" />
        </div>
      </PublicShell>
    );
  }
  if (hasStatus(pool.error, 410)) {
    return (
      <PublicShell>
        <div className={cardClass}>
          <EmptyState icon={<Hourglass className="size-5" aria-hidden />} message="This link has expired" />
        </div>
      </PublicShell>
    );
  }
  if (pool.isError) {
    return (
      <PublicShell>
        <div className={cardClass}>
          <ErrorState error={pool.error} onRetry={() => void pool.refetch()} retrying={pool.isFetching} />
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      {pool.data ? (
        <SummaryStrip
          items={[
            { label: "Company Name", value: pool.data.companyName },
            { label: "Job Role", value: pool.data.jobRole },
            { label: "Total Applied", value: formatNumber(pool.data.totalApplied) },
          ]}
        />
      ) : (
        <SummaryStripSkeleton count={3} />
      )}
      <DataTable
        caption="Final candidate pool"
        data={candidates}
        columns={columns}
        getRowId={(row) => row.ref}
        isLoading={pool.isPending}
        emptyState={<EmptyState message="There are no candidates in this pool." />}
      />
    </PublicShell>
  );
}
