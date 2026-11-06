/**
 * Semmal (செம்மல்): Tamil for a person of eminence, one honoured for doing the work well.
 * The mark: the Tamil letter செ on a warm gradient tile, with three nodes for the network of robots and agents.
 */
import { useId } from "react";

export const TAMIL_NAME = "செம்மல்";
const TAMIL_FONT = "var(--f-tamil), 'Noto Sans Tamil', 'Tamil Sangam MN', Latha, sans-serif";

export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB547" />
          <stop offset="0.5" stopColor="#FF5A3D" />
          <stop offset="1" stopColor="#E3247C" />
        </linearGradient>
        <radialGradient id={`h${id}`} cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#g${id})`} />
      <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#h${id})`} />
      <g stroke="#fff" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 14 20 20M51 14 44 20M32 55v-6" />
      </g>
      <g fill="#fff" fillOpacity="0.85">
        <circle cx="12" cy="13" r="3" />
        <circle cx="52" cy="13" r="3" />
        <circle cx="32" cy="57" r="2.6" />
      </g>
      <text x="32" y="43" textAnchor="middle" fontSize="27" fontWeight="800" fill="#fff" style={{ fontFamily: TAMIL_FONT }}>
        செ
      </text>
    </svg>
  );
}

/** The wordmark: mark + Semmal + செம்மல். */
export function Logo({ size = 30, tamil = true, className }: { size?: number; tamil?: boolean; className?: string }) {
  return (
    <span className={`brand ${className ?? ""}`}>
      <LogoMark size={size} />
      <span className="brand__text">
        <b className="brand__en">Semmal</b>
        {tamil && (
          <span className="brand__ta" lang="ta">
            {TAMIL_NAME}
          </span>
        )}
      </span>
    </span>
  );
}
