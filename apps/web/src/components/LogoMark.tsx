import { useId } from "react";

export function LogoMark({ className }: { className?: string }) {
  const key = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { bg: `jf-bg-${key}`, gloss: `jf-gl-${key}`, flow: `jf-fl-${key}`, glow: `jf-glow-${key}` };
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={ids.bg} x1="3" y1="2" x2="45" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7B5CFF" />
          <stop offset="0.5" stopColor="#4B2FE6" />
          <stop offset="1" stopColor="#1C1270" />
        </linearGradient>
        <linearGradient id={ids.gloss} x1="24" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ids.flow} x1="10" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#9FF6EA" />
        </linearGradient>
        <radialGradient id={ids.glow} cx="33.5" cy="24" r="13" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3EF0DA" stopOpacity="0.55" />
          <stop offset="1" stopColor="#3EF0DA" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${ids.bg})`} />
      <rect width="48" height="48" rx="13" fill={`url(#${ids.gloss})`} />
      <circle cx="33.5" cy="24" r="13" fill={`url(#${ids.glow})`} />
      <path
        d="M11.5 13.5c8.5 0 8.5 10.5 17 10.5M11.5 24h17M11.5 34.5c8.5 0 8.5-10.5 17-10.5"
        fill="none"
        stroke={`url(#${ids.flow})`}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="11.5" cy="13.5" r="3" fill="#fff" />
      <circle cx="11.5" cy="24" r="3" fill="#fff" />
      <circle cx="11.5" cy="34.5" r="3" fill="#fff" />
      <circle cx="33.5" cy="24" r="7.2" fill="#3EF0DA" />
      <path
        d="M30.2 24.1l2.3 2.3 4-4.2"
        fill="none"
        stroke="#14104A"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
