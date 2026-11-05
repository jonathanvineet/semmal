"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { Publisher } from "./Publisher";
import { ARKIV_EXPLORER, type Status } from "@/lib/api";

type AdminState = {
  owner: string | null;
  updatedAt: string;
  audit: { at: string; by: string; action: string; target?: string }[];
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function AdminDashboard() {
  const w = useWallet();
  const [state, setState] = useState<AdminState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = w.me?.role === "owner";

  const load = useCallback(async () => {
    if (!isAdmin) return setState(null);
    const r = await fetch("/api/admin/state", { credentials: "same-origin" });
    if (r.ok) setState(await r.json());
    fetch("/api/integrations/status").then((x) => x.json()).then(setStatus).catch(() => undefined);
  }, [isAdmin]);
  useEffect(() => {
    load();
  }, [load]);

  const claim = async () => {
    try {
      await post("/api/admin/claim", { code });
      setMsg("You are now the owner of this SEMMAL instance.");
      await w.refreshMe();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const transfer = async (action: string, address: string) => {
    try {
      setState(await post<AdminState>("/api/admin/transfer", { address }));
      void action;
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="admin">
      {/* ---------------- wallet & session */}
      <div className="pub-steps">
        <div className={`pub-step ${w.account ? "is-done" : ""}`}>
          <span className="mono">01</span>
          <div>
            <h3 className="t-card">Connect your wallet</h3>
            <p className="muted t-small">{w.account ? <span className="mono">{w.account}</span> : "MetaMask or any browser wallet."}</p>
          </div>
          {!w.account && <button className="btn btn--primary" type="button" onClick={w.connect}>Connect wallet</button>}
        </div>
        <div className={`pub-step ${w.me?.address && !w.mismatch ? "is-done" : ""}`}>
          <span className="mono">02</span>
          <div>
            <h3 className="t-card">Sign in with your wallet</h3>
            <p className="muted t-small">
              {w.me?.address ? (
                <>Signed in as <span className="mono">{short(w.me.address)}</span> · role <b>{w.me.role}</b></>
              ) : (
                "You sign a short text message. It is not a transaction and costs nothing."
              )}
            </p>
            {w.mismatch && <p className="t-small" style={{ color: "var(--warn)" }}>Your wallet switched accounts. Sign in again.</p>}
          </div>
          {w.account && (!w.me?.address || w.mismatch) && <button className="btn btn--primary" type="button" onClick={w.signIn}>Sign in</button>}
          {w.me?.address && !w.mismatch && <button className="btn btn--secondary" type="button" onClick={w.signOut}>Sign out</button>}
        </div>
        <div className={`pub-step ${w.me?.ownerSet ? "is-done" : ""}`}>
          <span className="mono">03</span>
          <div>
            <h3 className="t-card">{w.me?.ownerSet ? "Owner is set" : "Claim ownership"}</h3>
            <p className="muted t-small">
              {w.me?.ownerSet
                ? state?.owner
                  ? <>Owner <span className="mono">{short(state.owner)}</span></>
                  : "This dashboard belongs to the owner wallet."
                : "Enter the one-time setup code printed in the API terminal."}
            </p>
          </div>
          {!w.me?.ownerSet && w.me?.address && !w.mismatch && (
            <div className="claim">
              <input aria-label="Setup code" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn btn--primary" type="button" onClick={claim}>Claim ownership</button>
            </div>
          )}
        </div>
      </div>

      {(w.error || msg) && <p className="notice" role="status">{w.error ?? msg}</p>}

      {w.me?.address && !w.mismatch && w.me.ownerSet && !isAdmin && (
        <p className="notice">This wallet is not the owner of this Semmal instance.</p>
      )}

      {isAdmin && state && !w.mismatch && (
        <div className="grid admin-grid">
          <MyRobots owner={w.me!.address!} />
          <article className="card integ span-6">
            <h3 className="t-card">Integrations</h3>
            <dl>
              <div><dt>Arkiv Rabdi</dt><dd>{status ? (status.arkiv.reachable ? `chain ${status.arkiv.chainId}, reachable` : "unreachable") : "…"}</dd></div>
              <div><dt>Arkiv access key</dt><dd>{status ? (status.arkiv.accessKeyConfigured ? "configured" : "public endpoint") : "…"}</dd></div>
              <div><dt>0G Router key</dt><dd>{status ? (status.zerog.configured ? "configured" : "not set") : "…"}</dd></div>
              <div><dt>0G vision model</dt><dd className="mono">{status?.zerog.visionModel ? `${status.zerog.visionModel.id} · ${status.zerog.visionModel.status}` : "—"}</dd></div>
            </dl>
            <ProbeButton />
          </article>
          <article className="card integ span-6">
            <h3 className="t-card">Registry</h3>
            <p className="t-small muted">Everything you publish is owned by this wallet on Arkiv. Each write is signed in your wallet after you approve the fee.</p>
            <div className="btn-row">
              <Link className="btn btn--primary" href="/robots/new">Register a robot</Link>
              <a className="btn btn--secondary" href="#publish">Publish agents</a>
              <a className="btn btn--secondary" href={`${ARKIV_EXPLORER}/entity-explorer`} target="_blank" rel="noreferrer">Open entity explorer</a>
            </div>
            {w.me?.role === "owner" && <TransferOwner onTransfer={(a) => transfer("transfer_owner", a)} />}
          </article>
          <article id="publish" className="card integ span-12 publish-sec">
            <div className="integ__head">
              <h3 className="t-card">Publish specialist agents</h3>
              <span className="t-small muted">Owner only · signed by your wallet</span>
            </div>
            <Publisher />
          </article>
          <article className="card integ span-12">
            <h3 className="t-card">Audit log</h3>
            <ol className="audit">
              {state.audit.slice().reverse().slice(0, 20).map((e, i) => (
                <li key={i} className="mono t-small">
                  {e.at.replace("T", " ").slice(0, 19)} · {short(e.by)} · {e.action}{e.target ? ` · ${short(e.target)}` : ""}
                </li>
              ))}
            </ol>
          </article>
        </div>
      )}
    </div>
  );
}

function MyRobots({ owner }: { owner: string }) {
  const [rows, setRows] = useState<{ entityKey?: string; data: { robotId: string; displayName: string; model: string; capabilities: string[]; profileVersion: number } }[] | null>(null);
  useEffect(() => {
    fetch(`/api/robots?owner=${owner}`).then((r) => r.json()).then((d) => setRows(d.items ?? [])).catch(() => setRows([]));
  }, [owner]);
  return (
    <article className="card integ span-12">
      <div className="integ__head">
        <h3 className="t-card">Your robots on Arkiv</h3>
        <Link className="btn btn--primary" href="/robots/new">Register a robot</Link>
      </div>
      {rows === null && <p className="t-small muted">Reading Arkiv…</p>}
      {rows?.length === 0 && <p className="t-small muted">No robots owned by this wallet yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="role-list">
          {rows.map((r) => (
            <li key={r.data.robotId}>
              <span><b>{r.data.displayName}</b> <span className="muted">· {r.data.robotId} · v{r.data.profileVersion}</span></span>
              <span className="mono muted">{r.entityKey ? `${r.entityKey.slice(0, 10)}…` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function TransferOwner({ onTransfer }: { onTransfer: (a: string) => void }) {
  const [v, setV] = useState("");
  const [sure, setSure] = useState(false);
  return (
    <details className="transfer">
      <summary className="t-small">Transfer ownership</summary>
      <p className="t-small muted">The new wallet becomes the only owner. You keep no role unless they add you back.</p>
      <div className="claim">
        <input aria-label="New owner wallet" placeholder="0x… new owner" value={v} onChange={(e) => { setV(e.target.value); setSure(false); }} />
        {sure ? (
          <button className="btn btn--primary" type="button" onClick={() => onTransfer(v.trim())}>Confirm transfer</button>
        ) : (
          <button className="btn btn--secondary" type="button" onClick={() => setSure(true)} disabled={!v}>Transfer</button>
        )}
      </div>
    </details>
  );
}

function ProbeButton() {
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await fetch("/api/zerog/probe", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    setOut(r.ok ? `Request ID ${d.providerRequestId ?? "(none returned)"} · ${d.model} · ${d.requestedTrustMode} · ${d.latencyMs} ms` : `${d.code ?? "error"}: ${d.error}`);
    setBusy(false);
  };
  return (
    <div className="probe">
      <button className="btn btn--secondary" type="button" onClick={run} disabled={busy}>{busy ? "Calling 0G…" : "Run a 0G test call"}</button>
      {out && <p className="mono t-small">{out}</p>}
    </div>
  );
}
