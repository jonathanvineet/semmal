"use client";
import Link from "next/link";
import { arkivAddress, arkivEntity, galileoAddress } from "@/lib/explorers";
import { ExplorerLink } from "./ui/ExplorerLink";
import { useCallback, useEffect, useState } from "react";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ApprovalCard } from "./ui/ApprovalCard";
import { useWallet } from "@/lib/wallet";
import { AgentBuilder } from "./AgentBuilder";
import { AgentConsole } from "./AgentConsole";
import { MyAgents } from "./MyAgents";
import { RobotLink } from "./RobotLink";
import { OwnerRequests } from "./OwnerRequests";
import { Scores } from "./Scores";
import { RobotEvidence } from "./RobotEvidence";
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
            <p className="muted t-small">{w.account ? <span className="mono">{w.account}</span> : "Use Connect wallet at the top right (MetaMask or any browser wallet)."}</p>
          </div>
        </div>
        <div className={`pub-step ${w.me?.address && !w.mismatch ? "is-done" : ""}`}>
          <span className="mono">02</span>
          <div>
            <h3 className="t-card">Sign in with your wallet</h3>
            <p className="muted t-small">
              {w.me?.address ? (
                <>Signed in as <span className="mono">{short(w.me.address)}</span> · role <b>{w.me.role}</b></>
              ) : (
                "Use Sign in at the top right. You sign a short text message; it is not a transaction and costs nothing."
              )}
            </p>
            {w.mismatch && <p className="t-small" style={{ color: "var(--warn)" }}>Your wallet switched accounts. Sign in again.</p>}
          </div>
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
        <p className="t-small muted">You manage your own robots and agents here. Platform settings belong to the instance owner.</p>
      )}

      {w.me?.address && !w.mismatch && (isAdmin ? Boolean(state) : true) && (
        <div className="grid admin-grid">
          <OwnerRequests />
          <Scores isOwner={isAdmin} />
          <MyRobots owner={w.me!.address!} />
          {isAdmin && <article className="card integ span-6">
            <h3 className="t-card">Integrations</h3>
            <dl>
              <div><dt>Arkiv Rabdi</dt><dd>{status ? (status.arkiv.reachable ? `chain ${status.arkiv.chainId}, reachable` : "unreachable") : "…"}</dd></div>
              <div><dt>Arkiv access key</dt><dd>{status ? (status.arkiv.accessKeyConfigured ? "configured" : "public endpoint") : "…"}</dd></div>
              <div><dt>0G Router key</dt><dd>{status ? (status.zerog.configured ? "configured" : "not set") : "…"}</dd></div>
              <div><dt>0G vision model</dt><dd className="mono">{status?.zerog.visionModel ? `${status.zerog.visionModel.id} · ${status.zerog.visionModel.status}` : "—"}</dd></div>
            </dl>
            <ProbeButton />
          </article>}
          <article className={`card integ ${isAdmin ? "span-6" : "span-12"}`}>
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
              <h3 className="t-card">Build a specialist agent</h3>
              <span className="t-small muted">On a live 0G model · signed by your wallet</span>
            </div>
            <AgentBuilder />
          </article>
          <article id="agents" className="card integ span-12">
            <div className="integ__head">
              <h3 className="t-card">Your agents on Arkiv</h3>
              <span className="t-small muted">Robots hire from these themselves · delete one so no robot picks it</span>
            </div>
            <MyAgents owner={w.me!.address!} />
          </article>
          <article id="run" className="card integ span-12">
            <div className="integ__head">
              <h3 className="t-card">Run an agent</h3>
              <span className="t-small muted">A real job through the agent runner and 0G</span>
            </div>
            <AgentConsole owner={w.me!.address!} />
          </article>
          {isAdmin && state && <article className="card integ span-12">
            <h3 className="t-card">Audit log</h3>
            <ol className="audit">
              {state.audit.slice().reverse().slice(0, 20).map((e, i) => (
                <li key={i} className="mono t-small">
                  {e.at.replace("T", " ").slice(0, 19)} · {short(e.by)} · {e.action}{e.target ? ` · ${short(e.target)}` : ""}
                </li>
              ))}
            </ol>
          </article>}
        </div>
      )}
    </div>
  );
}

type MyRobot = { entityKey?: string; data: { robotId: string; robotWallet: string; displayName: string; model: string; capabilities: string[]; profileVersion: number } };

function MyRobots({ owner }: { owner: string }) {
  const ark = useArkivWriter();
  const [rows, setRows] = useState<MyRobot[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(`/api/robots?owner=${owner}`).then((r) => r.json()).then((d) => setRows(d.items ?? [])).catch(() => setRows([]));
  }, [owner]);
  useEffect(load, [load]);

  /** Every version of this robot that this wallet owns, then one wallet-signed delete each. */
  const remove = async (r: MyRobot) => {
    setBusy(r.data.robotId);
    setNote(null);
    try {
      const chk = await (await fetch(`/api/robots/check?wallet=${r.data.robotWallet}&owner=${owner}`)).json();
      const mine: { entityKey: string; creator: string; profileVersion: number }[] = (chk.existing ?? []).filter((e: { creator: string }) => e.creator.toLowerCase() === owner.toLowerCase());
      if (!mine.length) throw new Error("No entity owned by this wallet was found for this robot.");
      for (const e of mine) await ark.remove(`delete:${e.entityKey}`, owner, e.entityKey, "0.01");
      setNote(`${r.data.displayName} was deleted from Arkiv (${mine.length} version${mine.length === 1 ? "" : "s"}). The list refreshes in about 15 seconds.`);
      setRows((cur) => (cur ?? []).filter((x) => x.data.robotId !== r.data.robotId));
      setTimeout(load, 16_000);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <article className="card integ span-12">
      <div className="integ__head">
        <h3 className="t-card">Your robots on Arkiv</h3>
        <Link className="btn btn--primary" href="/robots/new">Register a robot</Link>
      </div>
      {!ark.onRabdi && rows && rows.length > 0 && <p className="t-small muted">Switch your wallet to Rabdi to delete a robot.</p>}
      {rows === null && <p className="t-small muted">Reading Arkiv…</p>}
      {rows?.length === 0 && <p className="t-small muted">No robots owned by this wallet.</p>}
      {rows && rows.length > 0 && (
        <ul className="role-list">
          {rows.map((r) => (
            <li key={r.data.robotId} className="my-robot">
              <span>
                <b>{r.data.displayName}</b> <span className="muted">· {r.data.robotId} · v{r.data.profileVersion}</span>
                <span className="t-small muted robot-chain">
                  {r.entityKey && <>profile <ExplorerLink href={arkivEntity(r.entityKey)} value={r.entityKey} /> · </>}
                  wallet <ExplorerLink href={arkivAddress(r.data.robotWallet)} value={r.data.robotWallet} n={6} label="on Arkiv" /> · <ExplorerLink href={galileoAddress(r.data.robotWallet)} value={r.data.robotWallet} n={6} label="on 0G Galileo" />
                </span>
              </span>
              <span className="robot-actions">
                {confirm === r.data.robotId ? (
                  <>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setConfirm(null)} disabled={busy !== null}>Keep</button>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(r)} disabled={busy !== null || !ark.onRabdi}>
                      {busy === r.data.robotId ? "Deleting…" : "Confirm delete"}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setConfirm(r.data.robotId)} disabled={busy !== null}>Delete</button>
                )}
              </span>
              <RobotLink robotId={r.data.robotId} capabilities={r.data.capabilities} />
              <RobotEvidence robotId={r.data.robotId} />
            </li>
          ))}
        </ul>
      )}
      {ark.approval && (
        <ApprovalCard
          what={`Delete · ${ark.approval.key.replace("delete:", "").slice(0, 18)}…`}
          account={owner}
          gas={ark.approval.gas}
          gasPrice={ark.approval.gasPrice}
          maximumCostWei={ark.approval.maximumCostWei}
          onApprove={() => ark.approval!.resolve(true)}
          onCancel={() => ark.approval!.resolve(false)}
        />
      )}
      {note && <p className="notice">{note}</p>}
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
