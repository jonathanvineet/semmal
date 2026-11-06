"use client";
/**
 * How the robot decided: each 0G call, step by step, as the robot reports it.
 *   camera frame -> agent hired and paid -> 0G Router (model, private mode, TEE provider) -> answer
 *   -> the robot's own checks -> what it did
 * Plus the fixed instructions the vision agent gives the model, the robot's rules and the 0G docs.
 * Never the image or the prompt bytes (they are not kept).
 */
import { useEffect, useState } from "react";

type Receipt = {
  providerRequestId?: string; model?: string; requestedTrustMode?: string; trustEvidence?: string; providerAddress?: string; chatId?: string;
  latencyMs?: number; billing?: string; inferenceCostNeuron?: string; paymentTx?: string; inputSha256?: string; outputSha256?: string; completedAt?: string; receiptHash?: string;
};
type Decision = {
  at: string; stop: string; attempt: number; agentId: string; agentName: string; agentPrice0G: string; paymentTx?: string; question: string; frame: string;
  model: string; trustMode: string; receipt?: Receipt; output?: Record<string, unknown>;
  checks: { format: boolean; actionAllowed: boolean; confidence: number | null; confidenceFloor: number };
  outcome: string; action: string; reason?: string;
};
type Compute = {
  state: { state: string; detail?: string; at: string } | null;
  decisions: Decision[];
  method: { instructions: string; outputFormat: Record<string, string>; robotChecks: string[]; docs: { label: string; url: string }[] };
};

const TRUST: Record<string, string> = {
  tee_verified: "0G checked the provider's TEE signature on this answer: it came from a sealed enclave",
  tee_verification_failed: "0G reported the TEE signature did NOT verify, so the robot did not use the answer",
  requested_header_enforced_by_router: "Private mode was required on the request; the Router routes it to TEE providers only (no per-answer signature returned)",
};
const short = (s?: string, n = 10) => (s && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s ?? "—");
const og = (neuron?: string) => (neuron ? `${(Number(neuron) / 1e18).toFixed(6)} 0G` : "—");
const ACTION: Record<string, string> = {
  continue_mission: "carry on", pause_and_request_inspection: "stop and ask for a human / clean the spot", return_to_dock: "go back", abort_mission: "stop the job", hold: "hold position",
};

export function ComputeView({ taskId }: { taskId: string }) {
  const [c, setC] = useState<Compute | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`/api/tasks/${taskId}/compute`, { credentials: "same-origin" })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? "unavailable");
          setErr(null);
          setC(d);
        })
        .catch((e) => setErr((e as Error).message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [taskId]);

  if (err) return <p className="t-small muted">How it decided: {err}.</p>;
  if (!c) return null;
  return (
    <section className="cv" aria-label="How the robot decided">
      <div className="cv__head">
        <b>How it decided</b>
        <span className="t-small muted">{c.decisions.length ? `${c.decisions.length} 0G decision${c.decisions.length === 1 ? "" : "s"}` : "Appears once the robot starts working"}</span>
      </div>

      {c.decisions.map((d, i) => (
        <article key={i} className={`cv__card cv__card--${d.outcome}`}>
          <header className="cv__title">
            <b>{d.stop.replace(/_/g, " ")}</b>
            <span className="t-small muted">{new Date(d.at).toLocaleTimeString()}{d.attempt > 1 ? ` · attempt ${d.attempt}` : ""}</span>
            <span className={`cv__badge cv__badge--${d.outcome}`}>{d.outcome}</span>
          </header>
          <ol className="cv__steps">
            <li><span className="cv__k">1 · Looked</span><span>Camera frame ({d.frame}). The robot asked: <q>{d.question}</q></span></li>
            <li><span className="cv__k">2 · Hired</span><span>{d.agentName} for {d.agentPrice0G} 0G{d.paymentTx ? <>, paid in tx <span className="mono">{short(d.paymentTx, 8)}</span></> : ""}. The agent runs the model; the robot never holds a model key.</span></li>
            <li>
              <span className="cv__k">3 · 0G</span>
              <span>
                Sent through the 0G Router to <span className="mono">{d.receipt?.model ?? d.model}</span> in <b>{d.receipt?.requestedTrustMode ?? d.trustMode}</b> mode
                {d.receipt?.providerAddress ? <>, served by provider <span className="mono">{short(d.receipt.providerAddress, 6)}</span></> : ""}.
                <span className="cv__grid">
                  <span>0G request ID</span><span className="mono">{d.receipt?.providerRequestId ?? "none (no answer)"}</span>
                  <span>Trust</span><span>{d.receipt?.trustEvidence ? TRUST[d.receipt.trustEvidence] ?? d.receipt.trustEvidence : "—"}</span>
                  <span>Time</span><span>{d.receipt?.latencyMs !== undefined ? `${d.receipt.latencyMs} ms` : "—"}</span>
                  <span>0G cost</span><span>{og(d.receipt?.inferenceCostNeuron)}</span>
                  <span>Billed to</span><span>{d.receipt?.billing ?? "—"}</span>
                  <span>Input / answer hashes</span><span className="mono">{short(d.receipt?.inputSha256, 6)} / {short(d.receipt?.outputSha256, 6)}</span>
                </span>
              </span>
            </li>
            <li>
              <span className="cv__k">4 · Answer</span>
              <span>{d.output ? <pre className="cv__json mono">{JSON.stringify(d.output, null, 2)}</pre> : d.reason ?? "No answer."}</span>
            </li>
            <li>
              <span className="cv__k">5 · Checked</span>
              <span className="cv__checks">
                <span className={d.checks.format ? "ok" : "bad"}>exact format</span>
                <span className={d.checks.actionAllowed ? "ok" : "bad"}>allowed action</span>
                <span className={d.checks.confidence !== null && d.checks.confidence >= d.checks.confidenceFloor ? "ok" : "bad"}>
                  confidence {d.checks.confidence ?? "—"} ≥ {d.checks.confidenceFloor}
                </span>
              </span>
            </li>
            <li><span className="cv__k">6 · Did</span><span><b>{ACTION[d.action] ?? d.action}</b>{d.reason && d.outcome !== "accepted" ? ` (${d.reason})` : ""}</span></li>
          </ol>
        </article>
      ))}

      <details className="cv__method">
        <summary className="t-small">The method: what the model is told, what the robot checks, and the 0G docs</summary>
        <p className="t-small muted">Instructions the vision agent gives the model (fixed; the robot adds only the question above and the frame):</p>
        <pre className="cv__json mono">{c.method.instructions}</pre>
        <p className="t-small muted">The robot accepts an answer only if:</p>
        <ul className="t-small">{c.method.robotChecks.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="t-small muted">0G documentation:</p>
        <ul className="t-small">{c.method.docs.map((x) => <li key={x.url}><a className="link" href={x.url} target="_blank" rel="noreferrer">{x.label}</a></li>)}</ul>
      </details>
    </section>
  );
}
