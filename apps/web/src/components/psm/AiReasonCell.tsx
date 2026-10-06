import type { Candidate } from "../../types/api";
import { analysisFallback } from "../../utils/candidate";
import { Tooltip } from "../Tooltip";

function SkillList({ title, skills, className }: { title: string; skills: string[]; className: string }) {
  if (skills.length === 0) return null;
  return (
    <div>
      <p className={`font-semibold ${className}`}>{title}</p>
      <p className="text-slate-200">{skills.join(", ")}</p>
    </div>
  );
}

export function AiReasonCell({ candidate }: { candidate: Candidate }) {
  const reason = candidate.resumeReason?.trim();
  const text = reason || analysisFallback(candidate.analysisStatus);

  return (
    <Tooltip
      triggerClassName="block w-[200px] truncate text-muted"
      content={
        <div className="space-y-2">
          <p>{text}</p>
          <SkillList title="Matched skills" skills={candidate.matchedSkills} className="text-emerald-300" />
          <SkillList title="Missing skills" skills={candidate.missingSkills} className="text-rose-300" />
        </div>
      }
    >
      {text}
    </Tooltip>
  );
}
