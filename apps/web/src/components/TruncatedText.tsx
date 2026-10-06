import { cn } from "../utils/cn";
import { DASH } from "../utils/format";

interface TruncatedTextProps {
  value: string | null | undefined;
  className?: string;
}

export function TruncatedText({ value, className }: TruncatedTextProps) {
  const text = value?.trim();
  if (!text) return <span className="text-muted">{DASH}</span>;
  return (
    <span className={cn("block truncate", className)} title={text}>
      {text}
    </span>
  );
}
