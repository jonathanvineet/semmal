"use client";
/**
 * Build a specialist agent on a live 0G model and publish it to Arkiv with your wallet.
 * skill -> 0G model (live catalog, filtered by the input it needs) -> trust -> name -> price -> publish.
 * The price is the model's live cost for one job plus your margin; it is not typed in.
 */
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress } from "viem";
import { AgentListing } from "@semmal/contracts";
import { agentCreateArgs } from "@semmal/arkiv-adapter/browser";
import { useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ARKIV_EXPLORER } from "@/lib/api";
import { ApprovalCard } from "./ui/ApprovalCard";

type CatalogModel = { id: string; name: string; inputs: string[]; verifiability: string | null; promptNeuron: string; completionNeuron: string; contextLength: number | null };
type Catalog = { token: "0G"; models: CatalogModel[] };
type Trust = "private" | "verified" | "standard";

const KINDS = [
  { id: "vision", label: "Vision", cap: "vision.inspection", needsImage: true, tasks: ["warehouse.inspection", "aerial.inspection", "site.inspection", "warehouse.patrol", "outdoor.patrol"], hint: "Reads one camera frame and reports what it sees." },
  { id: "inspection", label: "Inspection", cap: "inspection.survey", needsImage: false, tasks: ["warehouse.inspection", "aerial.inspection", "site.inspection"], hint: "Plans an inspection and may hire a vision agent." },
  { id: "maintenance", label: "Maintenance", cap: "maintenance.diagnosis", needsImage: false, tasks: ["warehouse.inspection", "warehouse.patrol", "indoor.delivery", "site.inspection"], hint: "Reads motor and sensor diagnostics and suggests a cause." },
  { id: "navigation", label: "Navigation", cap: "navigation.planning", needsImage: false, tasks: ["warehouse.patrol", "indoor.delivery", "outdoor.patrol"], hint: "Plans routes and stop order for a job." },
  { id: "delivery-verification", label: "Delivery check", cap: "delivery.verification", needsImage: true, tasks: ["indoor.delivery"], hint: "Checks a drop-off photo against the order." },
] as const;

const ROBOT_TYPES = ["diff-drive-indoor", "aerial-multirotor", "legged-quadruped", "fixed-arm", "dexterous-hand", "humanoid", "mobile-manipulator"] as const;

const trustOf = (v: string | null): "TeeML" | "TeeTLS" | "none" | "unknown" => (v === "TeeML" ? "TeeML" : v === "TeeTLS" ? "TeeTLS" : v === null ? "unknown" : "none");
const allowed = (v: string | null): Trust[] => {
  const t = trustOf(v);
  if (t === "TeeML") return ["private", "verified", "standard"];
  if (t === "TeeTLS") return ["verified", "standard"];
  if (t === "unknown") return ["private", "verified", "standard"]; // the Router enforces per request
  return ["standard"];
};
/** 0G per 1M tokens, from neuron per token. */
const per1M = (neuron: string) => Number(formatUnits(BigInt(neuron) * 1_000_000n, 18)).toFixed(3);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 22) || "agent";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AgentBuilder() {
  const w = useWallet();
  const ark = useArkivWriter();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("vision");
  const [modelId, setModelId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [trust, setTrust] = useState<Trust>("private");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [margin, setMargin] = useState(40);
  const [delegate, setDelegate] = useState(false);
  const [price, setPrice] = useState<{ cost: string; price: string; tokensIn: number; tokensOut: number } | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [maxFee, setMaxFee] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ agentId: string; entityKey: string; txHash: string } | null>(null);

  const k = KINDS.find((x) => x.id === kind)!;

  useEffect(() => {
    fetch("/api/zerog/catalog")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "0G model list unavailable");
        setCat(d);
      })
      .catch((e) => setCatErr((e as Error).message));
  }, []);
  useEffect(() => { ark.refreshBalance(w.account); }, [w.account, ark.onRabdi]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cat?.models ?? []).filter((m) => (!k.needsImage || m.inputs.includes("image")) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
  }, [cat, k.needsImage, query]);
  const model = models.find((m) => m.id === modelId) ?? null;

  // keep the choices consistent: model fits the kind, trust fits the model
  useEffect(() => { if (modelId && !models.some((m) => m.id === modelId)) setModelId(""); }, [models, modelId]);
  useEffect(() => { if (model && !allowed(model.verifiability).includes(trust)) setTrust(allowed(model.verifiability)[0]!); }, [model, trust]);

  useEffect(() => {
    setPrice(null);
    setPriceErr(null);
    if (!model) return;
    const t = setTimeout(() => {
      fetch("/api/agents/price", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model.id, kind, marginPct: margin }) })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? "No price");
          setPrice(d);
        })
        .catch((e) => setPriceErr((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [model, kind, margin]);

  const agentId = w.account ? `agt-${slug(name)}-${w.account.slice(2, 8).toLowerCase()}` : "";
  const listing = useMemo(() => {
    if (!w.account || !model || !price || name.trim().length < 2) return null;
    const draft = {
      schemaVersion: "1.0" as const,
      agentId,
      ownerWallet: getAddress(w.account),
      displayName: name.trim(),
      kind,
      summary: summary.trim() || k.hint,
      endpoint: `${location.origin}/agents/${agentId}/jobs`,
      capabilities: [{ capabilityId: k.cap, inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", supportedRobotTypes: [...ROBOT_TYPES], supportedTaskTypes: [...k.tasks] }],
      price: { amount: price.price, token: "0G", unit: "job" as const },
      inference: { model: model.id, trustMode: trust },
      delegation: { allowed: kind === "inspection" && delegate, maxBudgetShare: kind === "inspection" && delegate ? 0.4 : 0 },
      serviceVersion: "1.0.0",
    };
    const r = AgentListing.safeParse(draft);
    return r.success ? r.data : null;
  }, [w.account, model, price, name, summary, kind, k, trust, delegate, agentId]);

  const publish = async () => {
    if (!listing || !w.account) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await ark.publish(`agent:${listing.agentId}:${listing.serviceVersion}`, w.account, agentCreateArgs(listing), maxFee);
      setDone({ agentId: listing.agentId, entityKey: r.entityKey, txHash: r.txHash });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      ark.refreshBalance(w.account);
    }
  };

  if (done)
    return (
      <motion.div className="ab-done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <b>{name.trim()} is on Arkiv.</b>
        <span className="muted t-small">Agent id <span className="mono">{done.agentId}</span> · entity <span className="mono">{short(done.entityKey)}</span> · <a className="link" href={`${ARKIV_EXPLORER}/tx/${done.txHash}`} target="_blank" rel="noreferrer">transaction</a></span>
        <button type="button" className="btn btn--secondary" onClick={() => { setDone(null); setName(""); setSummary(""); }}>Build another agent</button>
      </motion.div>
    );

  return (
    <div className="ab">
      {/* 1. skill */}
      <div className="ab__block">
        <span className="ab__n">1</span>
        <div className="ab__body">
          <h4>What does this agent do?</h4>
          <div className="chip-row">
            {KINDS.map((x) => (
              <button key={x.id} type="button" className={`pill-opt ${kind === x.id ? "is-on" : ""}`} aria-pressed={kind === x.id} onClick={() => setKind(x.id)}>{x.label}</button>
            ))}
          </div>
          <p className="t-small muted">{k.hint} {k.needsImage ? "Needs a model that reads images." : "Works with text models."}</p>
        </div>
      </div>

      {/* 2. model from 0G */}
      <div className="ab__block">
        <span className="ab__n">2</span>
        <div className="ab__body">
          <div className="ab__row">
            <h4>Which 0G model runs it?</h4>
            {cat && <span className="t-small muted">{models.length} live models from 0G{k.needsImage ? " that read images" : ""}</span>}
          </div>
          {catErr && <p className="soft-warn">{catErr}</p>}
          {!cat && !catErr && <p className="t-small muted">Reading the 0G model list…</p>}
          {cat && (
            <>
              <div className="sel__search ab__search">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                <input aria-label="Search 0G models" placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <ul className="ab__models" role="radiogroup" aria-label="0G model">
                {models.map((m) => {
                  const t = trustOf(m.verifiability);
                  return (
                    <li key={m.id}>
                      <button type="button" role="radio" aria-checked={m.id === modelId} className={`ab-model ${m.id === modelId ? "is-on" : ""}`} onClick={() => setModelId(m.id)}>
                        <span className="ab-model__name"><b>{m.name}</b><span className="mono muted">{m.id}</span></span>
                        <span className={`ab-trust ab-trust--${t}`}>{t === "TeeML" ? "Private TEE" : t === "TeeTLS" ? "Verified" : t === "unknown" ? "Trust unconfirmed" : "Standard"}</span>
                        <span className="ab-model__io muted">{m.inputs.includes("image") ? "Text + image" : "Text"}</span>
                        <span className="ab-model__price">{per1M(m.promptNeuron)} <small>0G / 1M in</small></span>
                      </button>
                    </li>
                  );
                })}
                {models.length === 0 && <li className="t-small muted ab__none">No live model matches.</li>}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* 3. trust */}
      <div className={`ab__block ${model ? "" : "is-locked"}`}>
        <span className="ab__n">3</span>
        <div className="ab__body">
          <h4>Which trust mode does it promise?</h4>
          <div className="seg ab__seg" role="radiogroup">
            {(["private", "verified", "standard"] as Trust[]).map((t) => {
              const ok = model ? allowed(model.verifiability).includes(t) : false;
              return (
                <button key={t} type="button" role="radio" aria-checked={trust === t} disabled={!ok} className="seg__opt" onClick={() => setTrust(t)}>
                  {trust === t && ok && <motion.span layoutId="ab-trust" className="seg__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span>{t === "private" ? "Private" : t === "verified" ? "Verified" : "Standard"}</span>
                </button>
              );
            })}
          </div>
          <p className="t-small muted">
            {model && trustOf(model.verifiability) === "unknown"
              ? "0G did not say which trust this model supports right now. The Router still refuses a private call it cannot serve; it never downgrades."
              : "Private runs only in a TEE: the prompt never leaves the enclave."}
          </p>
        </div>
      </div>

      {/* 4. name and price */}
      <div className={`ab__block ${model ? "" : "is-locked"}`}>
        <span className="ab__n">4</span>
        <div className="ab__body">
          <h4>Name and price</h4>
          <div className="ab__grid">
            <label className="field">
              <span className="t-label muted">Agent name</span>
              <input value={name} maxLength={60} placeholder="Panel Vision" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="t-label muted">One-line summary (optional)</span>
              <input value={summary} maxLength={160} placeholder={k.hint} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <label className="range">
              <span className="t-label muted">Margin on the model&apos;s cost</span>
              <span className="range__val">{margin}<small>%</small></span>
              <input type="range" min={0} max={300} step={5} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
            </label>
            <div className="ab-price">
              <span className="t-label muted">Price per job</span>
              {price ? (
                <>
                  <span className="ab-price__v">{price.price} <small>0G</small></span>
                  <span className="t-small muted">0G cost {price.cost} for ~{price.tokensIn + price.tokensOut} tokens + {margin}%</span>
                </>
              ) : priceErr ? (
                <span className="t-small ab-price__err">{priceErr}</span>
              ) : (
                <span className="t-small muted">{model ? "Pricing…" : "Pick a model first"}</span>
              )}
            </div>
          </div>
          {kind === "inspection" && (
            <label className="ab-toggle">
              <input type="checkbox" checked={delegate} onChange={(e) => setDelegate(e.target.checked)} />
              <span>May hire one vision agent, up to 40% of its job budget</span>
            </label>
          )}
        </div>
      </div>

      {/* 5. publish */}
      <div className={`ab__block ${listing ? "" : "is-locked"}`}>
        <span className="ab__n">5</span>
        <div className="ab__body">
          <h4>Publish to Arkiv</h4>
          <div className="pub-checks">
            <div className={`pub-check ${w.account ? "is-ok" : ""}`}>
              <span>Owner wallet</span>
              {w.account ? <b className="mono">{short(w.account)}</b> : <button className="btn btn--primary" type="button" onClick={w.connect}>Connect wallet</button>}
            </div>
            <div className={`pub-check ${ark.onRabdi ? "is-ok" : ""}`}>
              <span>Network</span>
              {ark.onRabdi ? <b>Rabdi</b> : <button className="btn btn--secondary" type="button" onClick={ark.switchToRabdi} disabled={!w.account}>Switch to Rabdi</button>}
            </div>
            <div className="pub-check">
              <span>Fee cap</span>
              <label className="fee-inline"><input inputMode="decimal" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} aria-label="Maximum fee in tGLM" /> tGLM</label>
            </div>
          </div>
          {listing && (
            <details className="json-peek">
              <summary><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>See exactly what goes on Arkiv</summary>
              <pre className="mono">{JSON.stringify(listing, null, 2)}</pre>
            </details>
          )}
          {ark.approval && (
            <ApprovalCard
              what={`Agent listing · ${ark.approval.key}`}
              account={w.account}
              gas={ark.approval.gas}
              gasPrice={ark.approval.gasPrice}
              maximumCostWei={ark.approval.maximumCostWei}
              onApprove={() => ark.approval!.resolve(true)}
              onCancel={() => ark.approval!.resolve(false)}
            />
          )}
          {msg && <p className="soft-warn">{msg}</p>}
          <div className="ab__actions">
            <button type="button" className="btn btn--primary" disabled={!listing || !ark.onRabdi || busy} onClick={publish}>{busy ? "Publishing…" : "Publish agent"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
