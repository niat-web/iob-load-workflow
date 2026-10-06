import type { ColumnDef } from "@tanstack/react-table";
import { candidateResumeUrl } from "../../api/psm";
import type { Candidate, CandidatePatch } from "../../types/api";
import { candidateStatusLabel, candidateStatusTone } from "../../utils/candidate";
import { cn } from "../../utils/cn";
import { DASH, orDash } from "../../utils/format";
import { CandidatePrioritySelect } from "../CandidatePrioritySelect";
import { RemarksInput } from "../RemarksInput";
import { ScoreCell } from "../ScoreCell";
import { StatusBadge } from "../StatusBadge";
import { TruncatedText } from "../TruncatedText";
import { linkClass } from "../ui/styles";
import { AiReasonCell } from "./AiReasonCell";
import { CandidateStatusSelect } from "./CandidateStatusSelect";

export interface CandidateColumnOptions {
  jobId: string;
  offset: number;
  candidateCount: number;
  readOnly: boolean;
  save: (studentId: string, patch: CandidatePatch) => Promise<boolean>;
}

const numeric = { headerClassName: "text-right", cellClassName: "text-right" };

function PriorityText({ value, changed }: { value: string; changed: boolean }) {
  return (
    <span className={cn("tabular-nums", changed && "rounded bg-primary-soft px-1.5 py-0.5 font-semibold text-primary")}>
      {value}
    </span>
  );
}

export function buildCandidateColumns(o: CandidateColumnOptions): ColumnDef<Candidate>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{o.offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "aiPriority",
      header: "AI Priority",
      cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.aiPriority}</span>,
    },
    {
      id: "studentName",
      header: "Student Name",
      cell: ({ row }) => <TruncatedText value={row.original.studentName} className="max-w-[180px] font-semibold" />,
    },
    {
      id: "studentId",
      header: "Student ID",
      cell: ({ row }) => <span className="text-muted tabular-nums">{row.original.studentId}</span>,
    },
    {
      id: "campus",
      header: "Campus",
      cell: ({ row }) => <TruncatedText value={orDash(row.original.campus)} className="max-w-[140px]" />,
    },
    {
      id: "resume",
      header: "Resume",
      cell: ({ row }) =>
        row.original.hasResume ? (
          <a
            href={candidateResumeUrl(o.jobId, row.original.studentId)}
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
      id: "resumeScore",
      header: "AI Resume Score",
      cell: ({ row }) => <ScoreCell value={row.original.resumeScore} />,
      meta: numeric,
    },
    {
      id: "gritScore",
      header: "GRIT Skill Score",
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
      id: "aiReason",
      header: "AI Reason",
      cell: ({ row }) => <AiReasonCell candidate={row.original} />,
    },
    {
      id: "finalPriority",
      header: "Final Priority",
      cell: ({ row }) => {
        const c = row.original;
        const changed = c.finalPriority !== c.aiPriority;
        if (o.readOnly) return <PriorityText value={c.finalPriority} changed={changed} />;
        return (
          <CandidatePrioritySelect
            value={c.finalPriority}
            aiPriority={c.aiPriority}
            count={o.candidateCount}
            label={`Final priority for ${c.studentName}`}
            onChange={(finalPriority) => o.save(c.studentId, { finalPriority })}
          />
        );
      },
    },
    {
      id: "psmRemarks",
      header: "PSM Remarks",
      cell: ({ row }) => {
        const c = row.original;
        if (o.readOnly) return <TruncatedText value={c.psmRemarks} className="max-w-[210px]" />;
        return (
          <RemarksInput
            value={c.psmRemarks}
            label={`PSM remarks for ${c.studentName}`}
            onSave={(psmRemarks) => o.save(c.studentId, { psmRemarks })}
          />
        );
      },
    },
    {
      id: "candidateStatus",
      header: "Candidate Status",
      cell: ({ row }) => {
        const c = row.original;
        if (o.readOnly) {
          return c.candidateStatus ? (
            <StatusBadge label={candidateStatusLabel(c.candidateStatus) ?? undefined} tone={candidateStatusTone(c.candidateStatus)} />
          ) : (
            <span className="text-muted">{DASH}</span>
          );
        }
        return (
          <CandidateStatusSelect
            value={c.candidateStatus}
            label={`Candidate status for ${c.studentName}`}
            onChange={(candidateStatus) => o.save(c.studentId, { candidateStatus })}
          />
        );
      },
    },
  ];
}
