"use client";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useApi, type AgentListing, type Entry, type Listing } from "@/lib/api";
import { AgentCard } from "./ui/AgentCard";
import { AgentDetail } from "./ui/AgentDetail";

const FILTERS = [
  { id: "all", label: "All agents" },
  { id: "vision", label: "Vision" },
  { id: "inspection", label: "Inspection" },
  { id: "maintenance", label: "Maintenance" },
] as const;

export function Marketplace({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const { data, error, loading } = useApi<Listing<AgentListing>>("/api/agents");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [open, setOpen] = useState<Entry<AgentListing> | null>(null);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const f = filter === "all" ? all : all.filter((e) => e.data.kind === filter);
    return limit ? f.slice(0, limit) : f;
  }, [data, filter, limit]);

  return (
    <LayoutGroup>
      {!compact && (
        <div className="market-bar">
          <div className="tabs" role="tablist" aria-label="Filter agents by kind">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" type="button" aria-selected={filter === f.id} className="tab" onClick={() => setFilter(f.id)}>
                {filter === f.id && <motion.span layoutId="tab-ind" className="tab__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="tab__label">{f.label}</span>
              </button>
            ))}
          </div>
          <RegistryLine listing={data} />
        </div>
      )}
      {error && <p className="notice">{error}</p>}
      {loading && (
        <ul className="agent-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="agent-cell"><div className="agent-card agent-card--skeleton" /></li>
          ))}
        </ul>
      )}
      {data && (
        <motion.ul className="agent-grid" layout>
          <AnimatePresence mode="popLayout">
            {items.map((e, i) => (
              <AgentCard key={e.data.agentId} entry={e} index={i} onOpen={() => setOpen(e)} />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
      <AnimatePresence>{open && <AgentDetail entry={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </LayoutGroup>
  );
}

export function RegistryLine({ listing }: { listing: Listing<unknown> | null }) {
  if (!listing) return null;
  const real = listing.items.filter((i) => i.provenance === "ARKIV").length;
  const sim = listing.items.length - real;
  return (
    <p className="registry-line t-small">
      <span className={`dot ${listing.arkiv.ok ? "dot--ok" : "dot--bad"}`} aria-hidden="true" />
      {listing.arkiv.ok ? `Arkiv Rabdi reachable · ${real} on-chain listing${real === 1 ? "" : "s"}` : "Arkiv unreachable"}
      {sim > 0 && <span className="muted"> · {sim} SIMULATED seed listing{sim === 1 ? "" : "s"}</span>}
    </p>
  );
}
