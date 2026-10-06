import { CircleCheck, Copy } from "lucide-react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { PsmJobDetail } from "../../types/api";
import { DASH, formatDateTime } from "../../utils/format";
import { Button } from "../ui/Button";
import { linkClass } from "../ui/styles";

export function SubmittedNote({ job }: { job: PsmJobDetail }) {
  const copy = useCopyToClipboard();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-3 text-sm"
    >
      <p className="flex items-center gap-2 text-emerald-800">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        Submitted by {job.reviewedBy ?? DASH} on {formatDateTime(job.submittedAt)}
      </p>
      {job.publicLinkUrl && (
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={job.publicLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} max-w-[480px] truncate`}
          >
            <span className="truncate">{job.publicLinkUrl}</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <Button
            variant="secondary"
            size="sm"
            icon={<Copy className="size-3.5" aria-hidden />}
            onClick={() => void copy(job.publicLinkUrl ?? "", "Public link copied")}
          >
            Copy link
          </Button>
        </div>
      )}
    </div>
  );
}
