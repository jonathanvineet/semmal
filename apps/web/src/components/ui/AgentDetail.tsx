"use client";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { AgentListing, Entry } from "@/lib/api";
import { IconClose, kindIcon } from "./Icons";
import { ARKIV_DATA_EXPLORER, ProvenanceBadge } from "./Provenance";
import { Lanes } from "./AgentCard";

export function AgentDetail({ entry, onClose }: { entry: Entry<AgentListing>; onClose: () => void }) {
  const a = entry.data;
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div className="detail-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        layoutId={`agent-${a.agentId}`}
        className={`agent-card agent-card--open agent-card--${a.kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-h"
        onClick={(e) => e.stopPropagation()}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
      >
        <div className="agent-card__top">
          <span className="agent-card__kind">
            <span className="agent-card__icon">{kindIcon(a.kind)}</span>
            {a.kind}
          </span>
          <button ref={closeBtn} type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <IconClose size={18} />
          </button>
        </div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 id="detail-h" className="agent-card__name">{a.displayName}</h2>
          <p className="agent-card__summary">{a.summary}</p>
          <Lanes entry={entry} />
          <dl className="detail-grid">
            <div><dt>Price</dt><dd>{a.price.amount} {a.price.token} per {a.price.unit}</dd></div>
            <div><dt>0G model</dt><dd className="mono">{a.inference?.model ?? "none"}</dd></div>
            <div><dt>Required trust mode</dt><dd>{a.inference?.trustMode ?? "none"}</dd></div>
            <div><dt>Delegation</dt><dd>{a.delegation.allowed ? `May hire, up to ${Math.round(a.delegation.maxBudgetShare * 100)}% of its budget` : "Does not hire others"}</dd></div>
            <div><dt>Service version</dt><dd className="mono">{a.serviceVersion}</dd></div>
            <div><dt>Owner wallet</dt><dd className="mono">{a.ownerWallet.slice(0, 10)}…{a.ownerWallet.slice(-6)}</dd></div>
          </dl>
          <h3 className="t-label muted detail-sub">Capabilities</h3>
          <ul className="cap-list">
            {a.capabilities.map((c) => (
              <li key={c.capabilityId}>
                <span className="mono">{c.capabilityId}</span>
                <span className="muted">
                  {c.supportedTaskTypes.join(", ")} · schema {c.inputSchemaVersion} → {c.outputSchemaVersion}
                </span>
              </li>
            ))}
          </ul>
          <div className="detail-foot">
            <ProvenanceBadge provenance={entry.provenance} entityKey={entry.entityKey} />
            {entry.provenance === "ARKIV" ? (
              <a className="link" href={ARKIV_DATA_EXPLORER} target="_blank" rel="noreferrer">
                Open the Rabdi entity explorer
              </a>
            ) : (
              <span className="t-small muted">Not on Arkiv.</span>
            )}
          </div>
          <p className="t-small muted detail-note">Robots choose agents themselves. This page lists them; it does not assign them.</p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
