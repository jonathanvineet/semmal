"use client";
/**
 * Two parts of a booking:
 *  - ExtraStops: while the robot works, the customer asks for one more stop; the robot answers each request
 *    itself (place, budget, limit) and the answer shows here.
 *  - ArkivRecord: what the robot wrote to Arkiv for this job, read back from Arkiv (schema, indexed columns,
 *    stored body, owner, expiry), and how the job score and the robot's score were calculated.
 */
import { useCallback, useEffect, useState } from "react";
import { SKILL_STOPS } from "@semmal/contracts";
import { arkivAddress, arkivEntity } from "@/lib/explorers";
import { ExplorerLink } from "./ui/ExplorerLink";

type Extra = { extraId: string; stop: string; requestedAt: string; accepted?: boolean; reason?: string; decidedAt?: string };
const WORKING = ["PAID", "DISCOVERING_SPECIALISTS", "HIRING_SPECIALISTS", "PLANNING", "EXECUTING", "VERIFYING", "WAITING_FOR_0G"];
const place = (s: string) => s.replace(/_/g, " ");

export function ExtraStops({ taskId, skill }: { taskId: string; skill: string }) {
  const [state, setState] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = SKILL_STOPS[skill] ?? [];

  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks/${taskId}/compute`, { credentials: "same-origin" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setState(d.state?.state ?? null);
    setExtras(d.extras ?? []);
  }, [taskId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const working = state !== null && WORKING.includes(state);
  if (!working && extras.length === 0) return null;

  const send = async () => {
    if (!stop) return;
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/tasks/${taskId}/extras`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ stop }) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) return setErr(d?.error ?? "Could not send the request");
    setStop("");
    load();
  };

  return (
    <section className="jr" aria-label="Extra stops">
      <div className="jr__head">
        <b>Extra stops</b>
        <span className="t-small muted">Ask the robot to add a place while it works. It decides: the place must suit this job, and what you paid must still cover the extra check.</span>
      </div>
      {working && (
        <div className="jr__ask">
          <select className="jr__select" value={stop} onChange={(e) => setStop(e.target.value)} aria-label="Place to add">
            <option value="">Choose a place</option>
            {options.map((o) => <option key={o} value={o}>{place(o)}</option>)}
          </select>
          <button type="button" className="btn btn--secondary btn--sm" disabled={!stop || busy} onClick={send}>{busy ? "Sending…" : "Ask the robot"}</button>
        </div>
      )}
      {err && <p className="soft-warn t-small">{err}</p>}
      {extras.length > 0 && (
        <ul className="jr__list">
          {extras.map((x) => (
            <li key={x.extraId}>
              <span className={`jr__badge jr__badge--${x.accepted === undefined ? "wait" : x.accepted ? "ok" : "no"}`}>{x.accepted === undefined ? "waiting" : x.accepted ? "added" : "declined"}</span>
              <b>{place(x.stop)}</b>
              <span className="t-small muted">{x.reason ?? "the robot answers at its next stop"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Part = { id: string; label: string; judged: boolean; points: number; max: number; detail: string };
type RecordView = {
  record: null | { schema: string; entityKey: string; owner: string; creator: string; expiresAtBlock: string; createdAtBlock?: string; indexed: Record<string, unknown>; body: any };
  agentScores: { agentId: string; name: string; score: number; judged: number; status: string; selection: number | null; source: string }[];
  robotScore: { formula: string; selection: number | null; score: number; status: string; reason: string; judged: number; counts: Record<string, number>; episodesOnArkiv: number; jobScores: { taskId: string; outcome: string; score: number | null }[] };
  formulas: { task: string; weights: Record<string, number>; agentJob: string; robot: string; rules: Record<string, number>; selection: { score: number; weight: number; band: number } };
};

export function ArkivRecord({ taskId }: { taskId: string }) {
  const [v, setV] = useState<RecordView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks/${taskId}/record`, { credentials: "same-origin" }).catch(() => null);
    if (!r) return setErr("the API is not reachable");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error ?? "unavailable");
    setErr(null);
    setV(d);
  }, [taskId]);
  useEffect(() => {
    load();
    const t = setInterval(() => !v?.record && load(), 15_000);
    return () => clearInterval(t);
  }, [load, v?.record]);

  if (err) return <p className="t-small muted">What went to Arkiv: {err}.</p>;
  if (!v) return null;
  const rec = v.record;
  const score = rec?.body?.score as undefined | { formula: string; score: number; points: number; max: number; parts: Part[] };
  const rs = v.robotScore;
  const judgedScores = rs.jobScores.map((j) => (j.score ?? (j.outcome === "COMPLETED" ? 100 : 0)));
  const mean = judgedScores.length ? judgedScores.reduce((t, x) => t + x, 0) / judgedScores.length : 100;
  const penalty = 20 * Math.min(1, rs.counts.episodes ? (rs.counts.incidents ?? 0) / rs.counts.episodes : 0);

  return (
    <section className="jr" aria-label="What went to Arkiv">
      <div className="jr__head">
        <b>What went to Arkiv</b>
        <span className="t-small muted">
          {rec ? "Read back from Arkiv: exactly what is stored, signed by the robot's own key." : "The robot writes its record after the job: saved on the robot, then the bundle on 0G Storage, then this entry on Arkiv. Nothing on Arkiv for this job yet."}
        </span>
      </div>

      {rec && (
        <>
          <div className="jr__grid t-small">
            <span>Entity</span><span><ExplorerLink href={arkivEntity(rec.entityKey)} value={rec.entityKey} /></span>
            <span>Schema</span><span className="mono">{rec.schema}</span>
            <span>Owner (robot wallet)</span><span><ExplorerLink href={arkivAddress(rec.owner)} value={rec.owner} n={6} /></span>
            <span>Expires at block</span><span className="mono">{rec.expiresAtBlock}</span>
            <span>0G Storage bundle</span><span className="mono">{String(rec.body?.storageRoot ?? "—")}</span>
          </div>

          <h4 className="ev__h">Indexed columns (anyone can query these)</h4>
          <table className="ev__table">
            <tbody>{Object.entries(rec.indexed).map(([k, x]) => <tr key={k}><td className="mono">{k}</td><td className="mono">{String(x)}</td></tr>)}</tbody>
          </table>

          {score && (
            <>
              <h4 className="ev__h">How this job was scored ({score.formula})</h4>
              <table className="ev__table">
                <thead><tr><th>Part</th><th>What the robot recorded</th><th>Points</th></tr></thead>
                <tbody>
                  {score.parts.map((p) => (
                    <tr key={p.id} className={p.judged ? "" : "muted"}>
                      <td>{p.label}</td><td>{p.detail}</td><td className="mono">{p.judged ? `${p.points} / ${p.max}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="t-small">
                Score = round(100 × {score.points} / {score.max}) = <b className="mono">{score.score}</b>. Weights: completion {v.formulas.weights.completion}, decisions {v.formulas.weights.decisions}, findings {v.formulas.weights.findings}, extras {v.formulas.weights.extras}, on time {v.formulas.weights.onTime}; a part that does not apply is left out, and after a safe stop only the decisions count.
              </p>
            </>
          )}
          {!score && <p className="t-small muted">This record was written before job scores existed ({rec.schema}); the robot&apos;s score counts it as {rec.body?.outcome === "COMPLETED" ? 100 : rec.body?.outcome === "FAILED" ? 0 : "not judged"}.</p>}

          <details className="cv__method">
            <summary className="t-small">The stored body (decoded from the entity&apos;s bytes)</summary>
            <pre className="cv__json mono">{JSON.stringify(rec.body, null, 2)}</pre>
          </details>
        </>
      )}

      {rec?.body?.agentJobs?.length > 0 && (
        <>
          <h4 className="ev__h">How the robot scored the agents it paid ({v.formulas.agentJob})</h4>
          <p className="t-small muted">Delivered before the deadline 40 · passed the robot&apos;s checks 40 · speed 20 (within half the deadline 20, within it 10). These job scores are in the record above, signed by the robot; each agent&apos;s score is the mean of the job scores robots gave it, and its selection score decides who gets hired next.</p>
          <table className="ev__table">
            <thead><tr><th>Agent</th><th>This job</th><th>Agent score</th><th>Selection</th></tr></thead>
            <tbody>
              {(rec!.body.agentJobs as { agentId: string; at: string; status: string; score: number }[]).map((j, i) => {
                const a = v.agentScores.find((x) => x.agentId === j.agentId);
                return (
                  <tr key={i}>
                    <td>{a?.name ?? j.agentId}</td>
                    <td className="mono">{j.score} ({j.status})</td>
                    <td className="mono">{a ? `${a.score} over ${a.judged} job${a.judged === 1 ? "" : "s"} · ${a.status}` : "—"}</td>
                    <td className="mono">{a?.selection ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <h4 className="ev__h">The robot&apos;s score ({rs.formula}), from its {rs.episodesOnArkiv} episode{rs.episodesOnArkiv === 1 ? "" : "s"} on Arkiv</h4>
      <p className="t-small">
        Judged jobs (completed or failed): {rs.judged}. Mean job score {mean.toFixed(1)}{judgedScores.length ? ` (${judgedScores.join(" + ")}) / ${judgedScores.length}` : ""}; incident penalty 20 × min(1, {rs.counts.incidents ?? 0} / {rs.counts.episodes ?? 0}) = {penalty.toFixed(1)}.
        Score = round({mean.toFixed(1)} − {penalty.toFixed(1)}) = <b className="mono">{rs.score}</b> · <b>{rs.status}</b> ({rs.reason}).
        Selection score for booking = round(({rs.judged} × {rs.score} + {v.formulas.selection.weight} × {v.formulas.selection.score}) / ({rs.judged} + {v.formulas.selection.weight})) = <b className="mono">{rs.selection ?? "excluded"}</b>.
      </p>
      <p className="t-small muted">
        Safe stops and cancelled jobs are not judged. Under {v.formulas.rules.minJudged} judged jobs a robot is new; with {v.formulas.rules.excludeMinJudged} or more and a score under {v.formulas.rules.excludeBelow} it leaves discovery; under {v.formulas.rules.watchBelow} it is on watch.
        The instance owner can publish this score to Arkiv as a reputation checkpoint (dashboard → Scores).
      </p>
    </section>
  );
}
