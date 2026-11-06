"use client";
/**
 * A robot's evidence: episodes and incidents the robot itself wrote to Arkiv, each opened by
 * downloading its bundle from 0G Storage with proof and checking hash, signature and Arkiv link
 * on the server. Shows what the robot accessed, what it bought, what 0G told it and what it did.
 */
import { useCallback, useEffect, useState } from "react";
import { ARKIV_EXPLORER } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = { key: string; data: any };
type Checks = { storageProof: boolean; manifestHash: boolean | null; signature: boolean; arkivLink: boolean; detail: string[] };
type Opened = { record: Rec; bundle?: any; checks: Checks };

const t = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "");
const hm = (iso?: string) => (iso ? iso.slice(11, 19) : "");
const short = (s?: string, n = 10) => (s && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s ?? "");

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return <span className={`ev__check ${ok === null ? "" : ok ? "ev__check--ok" : "ev__check--bad"}`}>{ok === null ? "–" : ok ? "✓" : "✕"} {label}</span>;
}

function Episode({ b }: { b: any }) {
  return (
    <div className="ev__body">
      <p className="t-small">
        <b>{b.skill}</b> in <b>{b.world ?? "unknown world"}</b> · {b.outcome} · stops {(b.stops ?? []).join(" → ") || "none"} · {hm(b.startedAt)}–{hm(b.endedAt)}
      </p>

      <h4 className="ev__h">What it accessed</h4>
      <table className="ev__table">
        <thead><tr><th>Time</th><th>What</th><th>From</th><th>Detail</th><th>Left the robot</th></tr></thead>
        <tbody>
          {(b.access ?? []).map((a: any, i: number) => (
            <tr key={i}><td className="mono">{hm(a.at)}</td><td>{a.what}</td><td>{a.source}</td><td>{a.detail}</td><td>{a.leftRobot ? "yes" : "no"}</td></tr>
          ))}
        </tbody>
      </table>

      <h4 className="ev__h">What it bought</h4>
      <table className="ev__table">
        <thead><tr><th>Time</th><th>Agent</th><th>For</th><th>Price</th><th>Result</th><th>0G request</th></tr></thead>
        <tbody>
          {(b.purchases ?? []).map((p: any, i: number) => (
            <tr key={i}>
              <td className="mono">{hm(p.at)}</td><td>{p.agentName} <span className="muted">({p.kind})</span></td><td>{p.forWhat}</td>
              <td className="mono">{p.priceUsdc} USDC</td><td>{p.status}</td>
              <td className="mono" title={p.providerRequestId}>{p.providerRequestId ? short(p.providerRequestId, 8) : "—"}{p.model ? <span className="muted"> · {p.model} · {p.trustMode}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-small muted">
        Quoted to the customer {b.spend?.quotedUsdc ?? "—"} USDC · agent jobs delivered {b.spend?.agentsUsdc ?? "0"} USDC
        {b.spend?.budgetUsdc ? ` · customer budget ${b.spend.budgetUsdc} USDC` : ""}. Agent payments are committed in job claims on Arkiv; they are not settled on chain yet.
      </p>
      {b.quote?.lines?.length > 0 && (
        <table className="ev__table">
          <thead><tr><th>Quote line</th><th>USDC</th><th>Price source</th></tr></thead>
          <tbody>{b.quote.lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td className="mono">{l.usdc}</td><td>{l.source}</td></tr>)}</tbody>
        </table>
      )}

      <h4 className="ev__h">What 0G told it</h4>
      <table className="ev__table">
        <thead><tr><th>Stop</th><th>Saw</th><th>Found</th><th>Confidence</th><th>Robot's verdict</th><th>Request ID</th><th>Latency</th></tr></thead>
        <tbody>
          {(b.decisions ?? []).map((d: any, i: number) => (
            <tr key={i}>
              <td>{d.checkpoint}</td><td>{d.observation ?? "—"}</td><td>{d.anomaly ?? "nothing"}</td><td className="mono">{d.confidence ?? "—"}</td>
              <td>{d.outcome} → {d.action}</td><td className="mono" title={d.providerRequestId}>{d.providerRequestId ? short(d.providerRequestId, 8) : "none"}</td><td className="mono">{d.latencyMs} ms</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="ev__h">What it did</h4>
      <ol className="ev__list">
        {(b.actions ?? []).map((a: any, i: number) => <li key={i}><span className="mono muted">{hm(a.at)}</span> <b>{a.stop}</b>: {a.action} <span className="muted">({a.why})</span></li>)}
      </ol>

      <details>
        <summary className="t-small">Every state change ({(b.transitions ?? []).length})</summary>
        <ol className="ev__list">
          {(b.transitions ?? []).map((s: any, i: number) => <li key={i}><span className="mono muted">{hm(s.at)}</span> <b>{s.state}</b> {s.reason}</li>)}
        </ol>
      </details>
    </div>
  );
}

function Incident({ b }: { b: any }) {
  const m = b.manifest ?? {};
  return (
    <div className="ev__body">
      <p className="t-small"><b>{m.fault_code}</b> · {m.severity} · {m.safety_action} · detected {t(m.detected_at)} · sequence {m.sequence_number}</p>
      <table className="ev__table">
        <tbody>{Object.entries(m.sensor_summary ?? {}).map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{String(v)}</td></tr>)}</tbody>
      </table>
      <p className="t-small muted">The stop happened on the robot before anything was sent. This record was written afterwards by the robot's own key.</p>
    </div>
  );
}

export function RobotEvidence({ robotId }: { robotId: string }) {
  const [list, setList] = useState<{ episodes: Rec[]; incidents: Rec[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; kind: string; data?: Opened; error?: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/robots/${robotId}/evidence`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error ?? "Could not load evidence");
    setErr(null);
    setList(d);
  }, [robotId]);
  useEffect(() => {
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, [load]);

  const view = async (kind: "episode" | "incident", id: string) => {
    if (open?.id === id) return setOpen(null);
    setOpen({ id, kind });
    const r = await fetch(`/api/evidence/${robotId}/${kind}/${id}`);
    const d = await r.json().catch(() => ({}));
    setOpen(r.ok ? { id, kind, data: d } : { id, kind, error: d.error ?? `Failed (${r.status})` });
  };

  const rows = [
    ...(list?.episodes ?? []).map((e) => ({ kind: "episode" as const, id: e.data.episodeId as string, at: e.data.endedAt as string, label: `${e.data.outcome}`, extra: `${(e.data.requestIds ?? []).length} 0G request(s)`, rec: e })),
    ...(list?.incidents ?? []).map((e) => ({ kind: "incident" as const, id: e.data.incidentId as string, at: e.data.detectedAt as string, label: `${e.data.faultCode} · ${e.data.severity}`, extra: e.data.safetyAction as string, rec: e })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div className="ev">
      <div className="ev__head">
        <b>Evidence log</b>
        <span className="t-small muted">Written by the robot's own key to 0G Storage and Arkiv. Appears here once it is on Arkiv; earlier stages show in the log above.</span>
      </div>
      {err && <p className="notice t-small">{err}</p>}
      {list && rows.length === 0 && <p className="t-small muted">No episodes or incidents on Arkiv for this robot yet.</p>}
      <ul className="ev__rows">
        {rows.map((r) => (
          <li key={r.kind + r.id}>
            <button type="button" className="ev__row" onClick={() => view(r.kind, r.id)} aria-expanded={open?.id === r.id}>
              <span className={`rl__kind rl__kind--${r.kind === "incident" ? "incident" : "task"}`}>{r.kind}</span>
              <span className="mono">{r.id}</span>
              <span>{r.label}</span>
              <span className="muted t-small">{r.extra}</span>
              <span className="muted t-small">{t(r.at)}</span>
            </button>
            {open?.id === r.id && (
              <div className="ev__open">
                {!open.data && !open.error && <p className="t-small muted">Downloading the bundle from 0G Storage with proof and checking it…</p>}
                {open.error && <p className="notice t-small">{open.error}</p>}
                {open.data && (
                  <>
                    <div className="ev__checks">
                      <Check ok={open.data.checks.storageProof} label="0G Storage proof" />
                      <Check ok={open.data.checks.manifestHash} label="content matches hash" />
                      <Check ok={open.data.checks.signature} label="signed by this robot" />
                      <Check ok={open.data.checks.arkivLink} label="matches Arkiv record" />
                      <a className="t-small link" href={`${ARKIV_EXPLORER}/entity-explorer`} target="_blank" rel="noreferrer" title="Search this key in the entity explorer">entity <span className="mono">{short(r.rec.key)}</span></a>
                      <span className="t-small muted mono" title={r.rec.data.storageRoot}>root {short(r.rec.data.storageRoot)}</span>
                    </div>
                    {open.data.checks.detail.length > 0 && <p className="t-small muted">{open.data.checks.detail.join(" · ")}</p>}
                    {open.data.bundle && (open.kind === "episode" ? <Episode b={open.data.bundle} /> : <Incident b={open.data.bundle} />)}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
