"use client";
/**
 * Robot and agent scores (score-v2): live, from evidence nobody can quietly edit, with the latest
 * checkpoint published on Arkiv. The instance owner publishes new checkpoints (one wallet-signed write
 * each, ~4 months on Arkiv). Excluded robots and agents are not offered for booking or hiring.
 */
import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { SCORE_FORMULA, SELECTION_PRIOR } from "@semmal/contracts";
import { reputationCreateArgs } from "@semmal/arkiv-adapter/browser";
import { useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { arkivEntity } from "@/lib/explorers";
import { ExplorerLink } from "./ui/ExplorerLink";
import { ApprovalCard } from "./ui/ApprovalCard";

type Row = {
  subjectKind: "robot" | "agent"; subjectId: string; name: string; score: number; status: "new" | "good" | "watch" | "excluded";
  judged: number; counts: Record<string, number>; lastActiveAt: string | null; reason: string;
  selection: number | null; source: string;
  published: { entityKey: string; score: number; status: string; computedAt: string } | null;
};
type Scores = { formula: string; rules: Record<string, number>; robots: Row[]; agents: Row[] };

export function Scores({ isOwner }: { isOwner: boolean }) {
  const w = useWallet();
  const ark = useArkivWriter();
  const [s, setS] = useState<Scores | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch("/api/scores").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const rows = s ? [...s.robots, ...s.agents] : [];
  // a checkpoint is due when the score or status changed, or the last one is over 30 days old
  const due = rows.filter((r) => !r.published || r.published.score !== r.score || r.published.status !== r.status || Date.now() - Date.parse(r.published.computedAt) > 30 * 86_400_000);

  const publish = async () => {
    if (!w.account) return w.connect();
    if (!ark.onRabdi) return ark.switchToRabdi();
    setBusy(true);
    setMsg(null);
    let done = 0;
    try {
      for (const r of due) {
        const args = reputationCreateArgs({
          schemaVersion: "1.0", formula: SCORE_FORMULA, subjectKind: r.subjectKind, subjectId: r.subjectId, score: r.score, status: r.status, judged: r.judged,
          counts: r.counts, lastActiveAt: r.lastActiveAt, computedAt: new Date().toISOString(), publisherWallet: getAddress(w.account),
        });
        await ark.publish(`score:${r.subjectId}:${Date.now()}`, w.account, args, "0.01");
        done++;
      }
      setMsg(`Published ${done} score checkpoint${done === 1 ? "" : "s"} on Arkiv.`);
    } catch (e) {
      setMsg(`${done} published; then: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(load, 4000);
    }
  };

  if (!s) return null;
  return (
    <article className="card integ span-12 sc">
      <div className="integ__head">
        <h3 className="t-card">Scores</h3>
        <span className="t-small muted">
          {s.formula}: robots from their own signed episodes, agents from the job scores the robots that hired them signed · the selection score
          ranks robots for booking and agents for hiring: (judged × score + {SELECTION_PRIOR.weight} × {SELECTION_PRIOR.score}) / (judged + {SELECTION_PRIOR.weight}), compared in {SELECTION_PRIOR.band}-point bands · excluded ones are never booked or hired
        </span>
      </div>
      <table className="ev__table sc__table">
        <thead><tr><th>Robot / agent</th><th>Score</th><th>Selection</th><th>Status</th><th>Why</th><th>Judged</th><th>Last active</th><th>On Arkiv</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subjectId}>
              <td><b>{r.name}</b> <span className="muted t-small">{r.subjectKind}</span></td>
              <td className="mono">{r.score}</td>
              <td className="mono" title={r.source}>{r.selection ?? "—"}</td>
              <td><span className={`sc__badge sc__badge--${r.status}`}>{r.status}</span></td>
              <td className="t-small">{r.reason}</td>
              <td className="mono">{r.judged}</td>
              <td className="t-small">{r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleDateString() : "—"}</td>
              <td className="t-small">{r.published ? <ExplorerLink href={arkivEntity(r.published.entityKey)} value={r.published.entityKey} label={`${r.published.score} · ${new Date(r.published.computedAt).toLocaleDateString()}`} /> : "not yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ark.approval && (
        <ApprovalCard what={`Score checkpoint · ${ark.approval.key}`} account={w.account} gas={ark.approval.gas} gasPrice={ark.approval.gasPrice} maximumCostWei={ark.approval.maximumCostWei}
          onApprove={() => ark.approval!.resolve(true)} onCancel={() => ark.approval!.resolve(false)} />
      )}
      {isOwner && (
        <div className="btn-row">
          <button type="button" className="btn btn--primary btn--sm" disabled={busy || due.length === 0} onClick={publish}>
            {busy ? "Publishing…" : due.length ? `Publish ${due.length} score${due.length === 1 ? "" : "s"} to Arkiv` : "Scores on Arkiv are up to date"}
          </button>
          <span className="t-small muted">Each checkpoint is signed by your wallet and lives about 4 months; publishing again refreshes it.</span>
        </div>
      )}
      {msg && <p className="t-small notice">{msg}</p>}
    </article>
  );
}
