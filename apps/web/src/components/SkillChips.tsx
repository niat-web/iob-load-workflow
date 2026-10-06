import { DASH } from "../utils/format";
import { Tooltip } from "./Tooltip";

export function SkillChips({ skills, max = 3 }: { skills: string[]; max?: number }) {
  if (skills.length === 0) return <span className="text-muted">{DASH}</span>;
  const shown = skills.slice(0, max);
  const hidden = skills.length - shown.length;
  return (
    <span className="flex items-center gap-1">
      {shown.map((skill) => (
        <span key={skill} className="max-w-[140px] truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
          {skill}
        </span>
      ))}
      {hidden > 0 && (
        <Tooltip
          content={skills.join(", ")}
          triggerLabel={`${hidden} more skills: ${skills.slice(max).join(", ")}`}
          triggerClassName="rounded-md px-1 text-xs font-semibold text-muted hover:text-ink"
        >
          +{hidden}
        </Tooltip>
      )}
    </span>
  );
}
