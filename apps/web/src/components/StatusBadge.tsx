import { CircleCheck, CircleDashed, CircleDot, CircleX, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import type { Chip, Tone } from "../types/api";
import { cn } from "../utils/cn";

const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/25",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/25",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/25",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/25",
  yellow: "bg-amber-50 text-amber-700 ring-amber-600/30",
  gray: "bg-slate-100 text-slate-600 ring-slate-500/25",
  red: "bg-rose-50 text-rose-600 ring-rose-600/25",
};

const TONE_ICONS: Record<Tone, LucideIcon> = {
  green: CircleCheck,
  blue: CircleDot,
  purple: CircleDot,
  orange: LoaderCircle,
  yellow: Clock,
  gray: CircleDashed,
  red: CircleX,
};

export function toneClass(tone: Tone | string): string {
  return TONE_CLASSES[tone as Tone] ?? TONE_CLASSES.gray;
}

interface StatusBadgeProps {
  chip?: Chip | null;
  label?: string;
  tone?: Tone;
  title?: string;
  className?: string;
}

export function StatusBadge({ chip, label, tone, title, className }: StatusBadgeProps) {
  const text = chip?.label ?? label;
  if (!text) return <span className="text-muted">—</span>;
  const resolvedTone = (chip?.tone ?? tone ?? "gray") as Tone;
  const Icon = chip ? (TONE_ICONS[resolvedTone] ?? CircleDashed) : null;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-4 font-semibold whitespace-nowrap ring-1 ring-inset",
        toneClass(resolvedTone),
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />}
      <span className="truncate">{text}</span>
    </span>
  );
}
