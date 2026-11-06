"use client";
/**
 * The specialist agents this wallet published on Arkiv, with a wallet-signed delete. Robots hire from
 * these listings themselves (cheapest agent with strong enough trust first), so removing an outdated
 * agent is how an owner stops robots from choosing it. Only entities this wallet created are deleted.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useArkivWriter } from "@/lib/arkiv-writer";
import type { AgentListing, Entry, Listing } from "@/lib/api";
import { groupMine, type Group } from "@/lib/agent-groups";
import { ApprovalCard } from "./ui/ApprovalCard";

export function MyAgents({ owner }: { owner: string }) {
  const ark = useArkivWriter();
  const [items, setItems] = useState<Entry<AgentListing>[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/agents").then((r) => r.json()).then((d: Listing<AgentListing>) => setItems(d.items ?? [])).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  const groups = useMemo(() => (items ? groupMine(items, owner) : null), [items, owner]);

  const remove = async (g: Group) => {
    setBusy(g.agentId);
    setNote(null);
    let done = 0;
    try {
      for (const key of g.keys) {
        await ark.remove(`delete:${key}`, owner, key, "0.01");
        done++;
      }
      setNote(`${g.latest.displayName} was deleted from Arkiv (${done} version${done === 1 ? "" : "s"}). Robots stop seeing it within about 15 seconds.`);
      setItems((cur) => (cur ?? []).filter((e) => e.data.agentId !== g.agentId));
      setTimeout(load, 16_000);
    } catch (e) {
      setNote(`${done ? `${done} of ${g.keys.length} versions were deleted before this stopped: ` : ""}${(e as Error).message}`);
      if (done) setTimeout(load, 16_000);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <div>
      {!ark.onRabdi && groups && groups.length > 0 && <p className="t-small muted">Switch your wallet to Rabdi to delete an agent.</p>}
      {groups === null && <p className="t-small muted">Reading Arkiv…</p>}
      {groups?.length === 0 && <p className="t-small muted">No agents published by this wallet.</p>}
      {groups && groups.length > 0 && (
        <ul className="role-list">
          {groups.map((g) => {
            const a = g.latest;
            return (
              <li key={g.agentId} className="my-robot">
                <span>
                  <b>{a.displayName}</b>{" "}
                  <span className="muted">
                    · {a.kind} · {a.price.amount} {a.price.token} per {a.price.unit}
                    {a.inference ? ` · ${a.inference.model} (${a.inference.trustMode})` : ""}
                    {g.keys.length > 1 ? ` · ${g.keys.length} versions` : ""}
                  </span>
                  {a.price.token !== "0G" && <span className="t-small soft-warn"> Robots pay agents in 0G only, so none can hire this one.</span>}
                </span>
                <span className="robot-actions">
                  {confirm === g.agentId ? (
                    <>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setConfirm(null)} disabled={busy !== null}>Keep</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(g)} disabled={busy !== null || !ark.onRabdi}>
                        {busy === g.agentId ? "Deleting…" : `Confirm delete${g.keys.length > 1 ? ` (${g.keys.length})` : ""}`}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setConfirm(g.agentId)} disabled={busy !== null}>Delete</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {ark.approval && (
        <ApprovalCard
          what={`Delete agent · ${ark.approval.key.replace("delete:", "").slice(0, 18)}…`}
          account={owner}
          gas={ark.approval.gas}
          gasPrice={ark.approval.gasPrice}
          maximumCostWei={ark.approval.maximumCostWei}
          onApprove={() => ark.approval!.resolve(true)}
          onCancel={() => ark.approval!.resolve(false)}
        />
      )}
      {note && <p className="notice">{note}</p>}
    </div>
  );
}
