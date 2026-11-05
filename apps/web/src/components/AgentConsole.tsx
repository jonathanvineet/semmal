"use client";
/**
 * Send a real job to one of your agents and see what 0G returns: the checked output, the provider
 * request ID, trust evidence and latency. Images are shrunk in the browser before they are sent and
 * are never stored.
 */
import { useEffect, useMemo, useState } from "react";
import { useApi, type AgentListing, type Listing } from "@/lib/api";
import { Select } from "./ui/Select";

const labelOf = (a: AgentListing) => `${a.displayName} · ${a.kind}`;

type Result = {
  jobId: string;
  status: "succeeded" | "failed" | "rejected";
  reason?: string;
  output?: unknown;
  cost?: { amount: string; token: string };
  receipt?: { providerRequestId?: string; model: string; requestedTrustMode: string; trustEvidence: string; latencyMs: number; receiptHash: string; providerAddress?: string };
};

const TRUST_EVIDENCE: Record<string, string> = {
  tee_verified: "TEE signature verified by 0G",
  requested_header_enforced_by_router: "Trust mode enforced by the 0G Router",
  tee_verification_failed: "TEE signature did not verify",
};

/** Shrink to at most 768 px on the long side and re-encode as JPEG, so only what is needed is sent. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

export function AgentConsole({ owner }: { owner: string }) {
  const { data } = useApi<Listing<AgentListing>>("/api/agents");
  const mine = useMemo(() => (data?.items ?? []).filter((e) => e.data.ownerWallet.toLowerCase() === owner.toLowerCase()), [data, owner]);
  const [agentId, setAgentId] = useState("");
  const agent = mine.find((e) => e.data.agentId === agentId)?.data ?? mine[0]?.data;
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRes(null); setErr(null); setImage(null); setText(""); }, [agent?.agentId]);

  if (!data) return <p className="t-small muted">Reading Arkiv…</p>;
  if (!agent) return <p className="t-small muted">Publish an agent above, then run it here.</p>;

  const kind = agent.kind;
  const looks = kind === "vision" || kind === "delivery-verification";
  const placeholder =
    kind === "vision" ? "Optional context, e.g. panel C-14 in aisle C"
      : kind === "delivery-verification" ? "The order, e.g. 2 boxes of M8 bolts"
        : kind === "maintenance" ? "Diagnostics as key: value lines, e.g.\nleft_motor_current_a: 8.5\nleft_motor_temperature_c: 105"
          : kind === "inspection" ? "What to inspect, e.g. 4 machine panels in aisle C"
            : "Stops, one per line";

  const buildInput = (): unknown => {
    if (kind === "vision") return { image, ...(text.trim() ? { context: text.trim() } : {}) };
    if (kind === "delivery-verification") return { image, order: text.trim() };
    if (kind === "maintenance") {
      const diagnostics: Record<string, number | string | boolean> = {};
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([\w.-]{1,40})\s*[:=]\s*(.+?)\s*$/);
        if (!m) continue;
        const v = m[2]!;
        diagnostics[m[1]!] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v.slice(0, 80);
      }
      return { diagnostics };
    }
    if (kind === "inspection") return { target: text.trim(), stops: Math.max(1, Number((text.match(/\d+/) ?? ["3"])[0])) };
    return { stops: text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30) };
  };

  const run = async () => {
    setBusy(true);
    setRes(null);
    setErr(null);
    try {
      const jobId = `job-${crypto.randomUUID()}`;
      const r = await fetch(`/api/agents/${agent.agentId}/jobs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId,
          parentTaskId: "console-test",
          requestingRobotId: "owner-console",
          targetAgentId: agent.agentId,
          capabilityId: agent.capabilities[0]!.capabilityId,
          input: buildInput(),
          budgetLimit: agent.price.amount,
          deadline: new Date(Date.now() + 60_000).toISOString(),
          idempotencyKey: jobId,
        }),
      });
      const d = await r.json();
      if (d.status) setRes(d);
      else throw new Error(d.error ?? `Request failed (${r.status})`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = looks ? Boolean(image) && (kind !== "delivery-verification" || text.trim().length > 1) : text.trim().length > 1;

  return (
    <div className="ac">
      <div className="ac__left">
        <Select
          label="Agent"
          value={labelOf(agent)}
          onChange={(v) => setAgentId(mine.find((e) => labelOf(e.data) === v)?.data.agentId ?? "")}
          groups={[{ label: "Your agents on Arkiv", options: mine.map((e) => labelOf(e.data)) }]}
          searchPlaceholder="Search your agents"
        />
        <p className="t-small muted">
          {agent.inference?.model} · {agent.inference?.trustMode} · {agent.price.amount} USDC per job
        </p>
        {looks && (
          <label className="ac__drop">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await shrink(f)); }} />
            {image ? <img src={image} alt="The frame that will be sent to the agent" /> : <span>Choose a photo<br /><small className="muted">Shrunk to 768 px in your browser, never stored</small></span>}
          </label>
        )}
        <label className="field">
          <span className="t-label muted">{looks ? (kind === "vision" ? "Context (optional)" : "The order") : "Input"}</span>
          <textarea rows={looks ? 2 : 5} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="button" className="btn btn--primary" disabled={!ready || busy} onClick={run}>{busy ? "Calling 0G…" : "Run job on 0G"}</button>
      </div>

      <div className="ac__right" aria-live="polite">
        {!res && !err && <p className="t-small muted">The agent's checked answer and its 0G receipt appear here.</p>}
        {err && <p className="soft-warn">{err}</p>}
        {res && (
          <div className={`ac-res ac-res--${res.status}`}>
            <span className="ac-res__status">{res.status === "succeeded" ? "Succeeded" : res.status === "failed" ? "Failed" : "Rejected"}</span>
            {res.reason && <p className="ac-res__reason">{res.reason}</p>}
            {res.output !== undefined && <pre className="mono">{JSON.stringify(res.output, null, 2)}</pre>}
            {res.receipt && (
              <dl className="ac-res__receipt">
                <div><dt>0G request ID</dt><dd className="mono">{res.receipt.providerRequestId ?? "none returned"}</dd></div>
                <div><dt>Model</dt><dd className="mono">{res.receipt.model}</dd></div>
                <div><dt>Trust</dt><dd>{res.receipt.requestedTrustMode} · {TRUST_EVIDENCE[res.receipt.trustEvidence] ?? res.receipt.trustEvidence}</dd></div>
                <div><dt>Latency</dt><dd>{res.receipt.latencyMs} ms</dd></div>
                {res.receipt.providerAddress && <div><dt>Provider</dt><dd className="mono">{res.receipt.providerAddress.slice(0, 10)}…</dd></div>}
                <div><dt>Receipt hash</dt><dd className="mono">{res.receipt.receiptHash.slice(0, 16)}…</dd></div>
                {res.cost && <div><dt>Charge</dt><dd>{res.cost.amount} {res.cost.token} <span className="muted">(payments not live yet)</span></dd></div>}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
