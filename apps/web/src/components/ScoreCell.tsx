import { formatScore } from "../utils/format";
import { Tooltip } from "./Tooltip";

export function ScoreCell({ value, missingHint }: { value: number | null; missingHint?: string }) {
  if (value === null || value === undefined) {
    if (missingHint) {
      return (
        <Tooltip content={missingHint} triggerClassName="text-muted underline decoration-dotted underline-offset-2">
          N/A
        </Tooltip>
      );
    }
    return <span className="text-muted">N/A</span>;
  }
  return <span className="tabular-nums">{formatScore(value)}</span>;
}
