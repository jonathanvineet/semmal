/**
 * Semmal (செம்மல்): Tamil for a person of eminence, one honoured for doing the work well.
 *
 * The mark is a robot: a line-drawn head whose antenna light is the pulli (புள்ளி), the dot Tamil writes
 * over a letter and that செம்மல் itself carries. The logotype sets both scripts on one line:
 * [robot] செம்மல் | Semmal. One ink colour, one accent; no gradients.
 */
export const TAMIL_NAME = "செம்மல்";

export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`brand__mark ${className ?? ""}`} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 9V5.6" />
        <rect x="5" y="9" width="22" height="18" rx="7" />
        <path d="M2.4 15.5v5M29.6 15.5v5" />
        <path d="M12.6 22.4h6.8" opacity="0.55" />
      </g>
      <circle cx="11.4" cy="17" r="2.1" fill="currentColor" />
      <circle cx="20.6" cy="17" r="2.1" fill="currentColor" />
      <circle className="brand__light" cx="16" cy="3.6" r="2.7" />
    </svg>
  );
}

/** [robot] செம்மல் | Semmal. `latin={false}` for tight spots. */
export function Logo({ latin = true, size = 26, className }: { latin?: boolean; size?: number; className?: string }) {
  return (
    <span className={`brand ${className ?? ""}`}>
      <LogoMark size={size} />
      <span className="brand__ta" lang="ta">{TAMIL_NAME}</span>
      {latin && (
        <>
          <span className="brand__rule" aria-hidden="true" />
          <span className="brand__en">Semmal</span>
        </>
      )}
    </span>
  );
}
