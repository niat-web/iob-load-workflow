import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:brightness-110 disabled:opacity-50 border border-transparent shadow-glow",
  secondary:
    "bg-surface text-ink border border-line hover:bg-slate-50 hover:border-slate-300 disabled:text-muted disabled:bg-slate-50 shadow-card",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-slate-100 hover:text-ink disabled:opacity-50",
  danger: "bg-red-600 text-white border border-transparent hover:bg-red-500 disabled:bg-red-300",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "focus-ring inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  label: string;
  large?: boolean;
  children: ReactNode;
}

export function IconButton({ label, large = false, children, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center border border-line bg-surface text-muted transition-colors hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60",
        large ? "size-10 rounded-lg" : "size-9 rounded-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
