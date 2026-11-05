"use client";
import { motion } from "motion/react";
import { useRef } from "react";
import type { AgentListing, Entry } from "@/lib/api";
import { IconLock, IconShield, kindIcon } from "./Icons";
import { ProvenanceBadge } from "./Provenance";

const kindLabel: Record<string, string> = {
  vision: "Vision",
  inspection: "Inspection",
  maintenance: "Maintenance",
  navigation: "Navigation",
  "delivery-verification": "Delivery check",
};

/** Robot -> agent -> 0G lanes with pulses (3.2 s loop, restarts on hover). */
export function Lanes({ entry }: { entry: Entry<AgentListing> }) {
  const a = entry.data;
  const delegates = a.delegation.allowed;
  return (
    <svg className="lanes" viewBox="0 0 300 64" aria-hidden="true">
      <line x1="34" y1="32" x2="150" y2="32" className="lanes__line" />
      <line x1="150" y1="32" x2="266" y2={delegates ? 14 : 32} className="lanes__line" />
      {delegates && <line x1="150" y1="32" x2="266" y2="50" className="lanes__line lanes__line--dim" />}
      <circle r="3" className="lanes__pulse lanes__pulse--a" style={{ offsetPath: "path('M34 32 L150 32')" }} />
      <circle r="3" className="lanes__pulse lanes__pulse--b" style={{ offsetPath: `path('M150 32 L266 ${delegates ? 14 : 32}')` }} />
      <g className="lanes__node"><rect x="10" y="20" width="48" height="24" rx="6" /><text x="34" y="36">robot</text></g>
      <g className="lanes__node lanes__node--me"><rect x="118" y="18" width="64" height="28" rx="7" /><text x="150" y="36">{kindLabel[a.kind]?.toLowerCase()}</text></g>
      <g className="lanes__node"><rect x="236" y={delegates ? 2 : 20} width="60" height="24" rx="6" /><text x="266" y={delegates ? 18 : 36}>{a.inference ? "0G" : "local"}</text></g>
      {delegates && (
        <g className="lanes__node lanes__node--dim"><rect x="236" y="38" width="60" height="24" rx="6" /><text x="266" y="54">hire</text></g>
      )}
    </svg>
  );
}

export function AgentCard({ entry, index, onOpen }: { entry: Entry<AgentListing>; index: number; onOpen: () => void }) {
  const a = entry.data;
  const ref = useRef<HTMLButtonElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !ref.current) return;
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <motion.li
      className="agent-cell"
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <motion.button
        ref={ref}
        type="button"
        layoutId={`agent-${a.agentId}`}
        className={`agent-card agent-card--${a.kind}`}
        onPointerMove={onMove}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${a.displayName}, ${kindLabel[a.kind]} agent, ${a.price.amount} ${a.price.token} per ${a.price.unit}. Open details`}
      >
        <span className="agent-card__glow" aria-hidden="true" />
        <span className="agent-card__top">
          <span className="agent-card__kind">
            <span className="agent-card__icon">{kindIcon(a.kind)}</span>
            {kindLabel[a.kind]}
          </span>
          <ProvenanceBadge provenance={entry.provenance} entityKey={entry.entityKey} />
        </span>
        <span className="agent-card__name">{a.displayName}</span>
        <span className="agent-card__summary">{a.summary}</span>
        <Lanes entry={entry} />
        <span className="agent-card__facts">
          <span>
            <span className="t-label muted">Price</span>
            <span className="agent-card__price">
              {a.price.amount} <span className="muted">{a.price.token} / {a.price.unit}</span>
            </span>
          </span>
          <span>
            <span className="t-label muted">Trust mode</span>
            <span className={`trust trust--${a.inference?.trustMode ?? "none"}`}>
              {a.inference?.trustMode === "private" ? <IconLock size={14} /> : <IconShield size={14} />}
              {a.inference?.trustMode ?? "no inference"}
            </span>
          </span>
        </span>
        <span className="agent-card__model mono">{a.inference?.model ?? "rule-based"}</span>
      </motion.button>
    </motion.li>
  );
}
