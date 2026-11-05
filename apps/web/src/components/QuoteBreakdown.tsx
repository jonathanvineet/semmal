"use client";
import { AnimatePresence, motion } from "motion/react";

export type QuoteLine = { label: string; detail: string; usdc: string; source: "arkiv" | "0g-router" | "estimate" | "policy" };
export type QuoteResult =
  | { status: "ok"; quote: string; cost: string; marginApplied: string; lines: QuoteLine[]; notes: string[]; quotedAt?: string }
  | { status: "declined"; reason: string; cost?: string; lines: QuoteLine[]; notes: string[]; quotedAt?: string };

const SOURCE: Record<QuoteLine["source"], string> = {
  arkiv: "Live price on Arkiv",
  "0g-router": "Live 0G token price",
  estimate: "Operating estimate",
  policy: "Owner's policy",
};

export function QuoteBreakdown({ q, compact = false }: { q: QuoteResult | null; compact?: boolean }) {
  if (!q) return <div className="quote quote--empty"><span className="muted t-small">Working out the price…</span></div>;
  return (
    <div className={`quote ${q.status === "ok" ? "is-ok" : "is-declined"} ${compact ? "quote--compact" : ""}`}>
      <div className="quote__head">
        {q.status === "ok" ? (
          <>
            <span className="t-label muted">The robot quotes</span>
            <motion.span key={q.quote} className="quote__total" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {q.quote} <small>USDC</small>
            </motion.span>
          </>
        ) : (
          <>
            <span className="t-label muted">The robot declines this task</span>
            <span className="quote__reason">{q.reason}</span>
          </>
        )}
      </div>
      {!compact && (
        <ul className="quote__lines">
          <AnimatePresence initial={false}>
            {q.lines.map((l, i) => (
              <motion.li key={l.label + l.detail} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                <span>
                  <b>{l.label}</b>
                  <span className="muted">{l.detail}</span>
                </span>
                <span className={`quote__src quote__src--${l.source}`}>{SOURCE[l.source]}</span>
                <span className="quote__amt">{l.usdc}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {q.status === "ok" && !compact && (
        <div className="quote__sum muted t-small">
          Cost {q.cost} USDC · margin {q.marginApplied} USDC
        </div>
      )}
      {!compact && q.notes.map((n) => <p key={n} className="quote__note t-small muted">{n}</p>)}
    </div>
  );
}
