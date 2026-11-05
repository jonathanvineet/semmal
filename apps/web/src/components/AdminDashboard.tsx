"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { ARKIV_EXPLORER, type Status } from "@/lib/api";

type AdminState = {
  owner: string | null;
  admins: string[];
  trustedPublishers: string[];
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
  const isAdmin = w.me?.role === "owner" || w.me?.role === "admin";

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

  const role = async (action: string, address: string) => {
    try {
      setState(await post<AdminState>("/api/admin/roles", { action, address }));
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
                  : "Only the owner and admins can open this dashboard."
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
        <p className="notice">This wallet is not an owner or admin. Ask the owner to add it.</p>
      )}

      {isAdmin && state && !w.mismatch && (
        <div className="grid admin-grid">
          <RoleList
            title="Admins"
            note={w.me?.role === "owner" ? "Admins can manage publishers and run the 0G probe." : "Only the owner can change admins."}
            items={state.admins}
            canEdit={w.me?.role === "owner"}
            onAdd={(a) => role("add_admin", a)}
            onRemove={(a) => role("remove_admin", a)}
          />
          <RoleList
            title="Trusted Arkiv publishers"
            note="The marketplace only shows Arkiv entities created by the owner, admins and these wallets."
            items={state.trustedPublishers}
            canEdit
            onAdd={(a) => role("add_publisher", a)}
            onRemove={(a) => role("remove_publisher", a)}
          />
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
            <p className="t-small muted">Publish the robot and agent profiles with this wallet. Each write is signed in your wallet after you approve the fee.</p>
            <div className="btn-row">
              <Link className="btn btn--primary" href="/publish">Publish to Arkiv</Link>
              <a className="btn btn--secondary" href={`${ARKIV_EXPLORER}/entity-explorer`} target="_blank" rel="noreferrer">Open entity explorer</a>
            </div>
            {w.me?.role === "owner" && <TransferOwner onTransfer={(a) => role("transfer_owner", a)} />}
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

function RoleList({ title, note, items, canEdit, onAdd, onRemove }: { title: string; note: string; items: string[]; canEdit: boolean; onAdd: (a: string) => void; onRemove: (a: string) => void }) {
  const [v, setV] = useState("");
  return (
    <article className="card integ span-6">
      <h3 className="t-card">{title}</h3>
      <p className="t-small muted">{note}</p>
      <ul className="role-list">
        {items.length === 0 && <li className="muted t-small">None yet</li>}
        {items.map((a) => (
          <li key={a}>
            <span className="mono">{a}</span>
            {canEdit && <button className="link" type="button" onClick={() => onRemove(a)}>Remove</button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="claim" onSubmit={(e) => { e.preventDefault(); onAdd(v.trim()); setV(""); }}>
          <input aria-label={`Add to ${title}`} placeholder="0x… wallet address" value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn btn--secondary" type="submit">Add wallet</button>
        </form>
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
