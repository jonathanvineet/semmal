"use client";
/**
 * Publish robot and agent profiles to Arkiv with YOUR wallet. No private key exists anywhere in
 * SEMMAL: the wallet signs and broadcasts; reads go through the API's read-only RPC proxy so the
 * Arkiv access key stays on the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { formatEther, http, parseEther } from "viem";
import {
  agentCreateArgs,
  guardedWalletClient,
  RABDI_CHAIN_ID,
  robotCreateArgs,
  walletSigner,
  type Eip1193,
} from "@semmal/arkiv-adapter/browser";
import type { AgentListing, RobotProfile } from "@semmal/contracts";
import { ARKIV_EXPLORER } from "@/lib/api";

type Drafts = { robots: RobotProfile[]; agents: AgentListing[]; ttlDays: number };
type JournalEntry = { key: string; phase: string; txHash?: string; entityKey?: string; at: string };
type Pending = { key: string; gas: bigint; gasPrice: bigint; maximumCostWei: bigint; resolve: (ok: boolean) => void };

// Values from SDK 1.0.1 src/chains/rabdi.ts (public endpoint, no access key).
const RABDI_WALLET_PARAMS = {
  chainId: "0x76edaf",
  chainName: "Rabdi (Arkiv testnet)",
  nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 },
  rpcUrls: ["https://rpc.rabdi.db-chain.testnet.arkiv.network"],
  blockExplorerUrls: [ARKIV_EXPLORER],
};
const JOURNAL = "semmal.arkiv.journal.v1";

const readJournal = (): JournalEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL) ?? "[]");
  } catch {
    return [];
  }
};

function eth(): Eip1193 | undefined {
  return (globalThis as { ethereum?: Eip1193 }).ethereum;
}

export function Publisher() {
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [maxFee, setMaxFee] = useState("0.01");
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const clientRef = useRef<ReturnType<typeof createPublicClient> | null>(null);

  const publicClient = useCallback(() => {
    if (!clientRef.current)
      clientRef.current = createPublicClient({
        chain: rabdi({ accessKey: "" }),
        transport: http(`${location.origin}/api/arkiv/rpc`, { timeout: 15_000, retryCount: 0 }),
      });
    return clientRef.current;
  }, []);

  const record = useCallback((e: Omit<JournalEntry, "at">) => {
    const next = [...readJournal(), { ...e, at: new Date().toISOString() }];
    localStorage.setItem(JOURNAL, JSON.stringify(next));
    setJournal(next);
  }, []);

  useEffect(() => {
    setJournal(readJournal());
    fetch("/api/registry/drafts").then((r) => r.json()).then(setDrafts).catch(() => setMessage("The SEMMAL API is not reachable."));
    const p = eth();
    if (!p) return;
    p.request({ method: "eth_accounts" }).then((a) => setAccount(((a as string[])[0]) ?? null));
    p.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c)));
    const w = p as Eip1193 & { on?: (e: string, f: (v: unknown) => void) => void; removeListener?: (e: string, f: (v: unknown) => void) => void };
    const onAcc = (a: unknown) => setAccount(((a as string[])[0]) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c));
    w.on?.("accountsChanged", onAcc);
    w.on?.("chainChanged", onChain);
    return () => {
      w.removeListener?.("accountsChanged", onAcc);
      w.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    if (!account || chainId !== RABDI_CHAIN_ID) return setBalance(null);
    publicClient()
      .getBalance({ address: account as `0x${string}`, blockTag: "latest" })
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [account, chainId, publicClient, busy]);

  const connect = async () => {
    const p = eth();
    if (!p) return setMessage("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
    const a = (await p.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(a[0] ?? null);
  };

  const addRabdi = async () => {
    const p = eth();
    if (!p) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RABDI_WALLET_PARAMS.chainId }] });
    } catch {
      await p.request({ method: "wallet_addEthereumChain", params: [RABDI_WALLET_PARAMS] });
    }
  };

  const publish = async (key: string, build: (owner: string) => ReturnType<typeof agentCreateArgs> | ReturnType<typeof robotCreateArgs>) => {
    const p = eth();
    if (!p || !account) return;
    const prior = readJournal().filter((e) => e.key === key);
    if (prior.some((e) => e.phase === "receipt_verified")) return setMessage(`${key} is already published from this browser.`);
    if (prior.some((e) => e.txHash))
      return setMessage(`${key} has an unconfirmed transaction in the journal. Check it on the explorer before trying again.`);
    let budget: bigint;
    try {
      budget = parseEther(maxFee);
    } catch {
      return setMessage("Enter the maximum fee in tGLM, for example 0.01.");
    }
    setBusy(key);
    setMessage(null);
    try {
      const { schema, values, options } = build(account);
      const client = guardedWalletClient({
        publicClient: publicClient(),
        signer: walletSigner(p, account),
        accessKey: "",
        maxCostWei: budget,
        journal: { record: (e) => record({ key, phase: String(e.phase), txHash: e.txHash as string | undefined, entityKey: e.entityKey as string | undefined }) },
        approve: (tx) =>
          new Promise<boolean>((resolve) => {
            record({ key, phase: "awaiting_approval" });
            setPending({ key, gas: tx.gas, gasPrice: tx.gasPrice, maximumCostWei: tx.maximumCostWei, resolve });
          }),
      });
      const receipt = await client.createEntity(schema, values, options);
      setMessage(`Published ${key}. Entity ${receipt.entityKey}`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(null);
      setBusy(null);
    }
  };

  const onRabdi = chainId === RABDI_CHAIN_ID;
  const ready = Boolean(account && onRabdi);
  const published = (key: string) => journal.some((e) => e.key === key && e.phase === "receipt_verified");

  return (
    <div className="publisher">
      <div className="pub-steps">
        <div className={`pub-step ${account ? "is-done" : ""}`}>
          <span className="mono">01</span>
          <div>
            <h3 className="t-card">Connect your wallet</h3>
            <p className="muted t-small">{account ? <span className="mono">{account}</span> : "Your wallet signs; SEMMAL never sees a key."}</p>
          </div>
          {!account && <button className="btn btn--primary" type="button" onClick={connect}>Connect wallet</button>}
        </div>
        <div className={`pub-step ${onRabdi ? "is-done" : ""}`}>
          <span className="mono">02</span>
          <div>
            <h3 className="t-card">Switch to Rabdi</h3>
            <p className="muted t-small">Arkiv testnet, chain {RABDI_CHAIN_ID}. {balance !== null && <>Balance {formatEther(balance)} tGLM.</>}</p>
          </div>
          {account && !onRabdi && <button className="btn btn--secondary" type="button" onClick={addRabdi}>Switch to Rabdi</button>}
          {onRabdi && balance === 0n && (
            <a className="btn btn--secondary" href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">Get test tGLM</a>
          )}
        </div>
        <div className="pub-step">
          <span className="mono">03</span>
          <div>
            <h3 className="t-card">Set a fee cap</h3>
            <p className="muted t-small">A create is refused before signing if its maximum fee is above this.</p>
          </div>
          <label className="fee">
            <span className="t-label muted">Max fee per create (tGLM)</span>
            <input inputMode="decimal" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} />
          </label>
        </div>
      </div>

      {message && <p className="notice" role="status">{message}</p>}

      {pending && (
        <div className="approve" role="alertdialog" aria-labelledby="approve-h">
          <h3 id="approve-h" className="t-card">Approve this Arkiv write</h3>
          <dl className="detail-grid">
            <div><dt>Profile</dt><dd className="mono">{pending.key}</dd></div>
            <div><dt>Gas limit</dt><dd className="mono">{pending.gas.toString()}</dd></div>
            <div><dt>Gas price</dt><dd className="mono">{pending.gasPrice.toString()} wei</dd></div>
            <div><dt>Maximum fee</dt><dd className="mono">{formatEther(pending.maximumCostWei)} tGLM</dd></div>
          </dl>
          <div className="btn-row">
            <button className="btn btn--primary" type="button" onClick={() => pending.resolve(true)}>Approve and open wallet</button>
            <button className="btn btn--secondary" type="button" onClick={() => pending.resolve(false)}>Cancel write</button>
          </div>
        </div>
      )}

      {drafts && (
        <div className="pub-list">
          {[
            ...drafts.robots.map((r) => ({ key: `robot:${r.robotId}:v${r.profileVersion}`, name: r.displayName, kind: "Robot", build: (o: string) => robotCreateArgs({ ...r, ownerWallet: o }, drafts.ttlDays) })),
            ...drafts.agents.map((a) => ({ key: `agent:${a.agentId}:${a.serviceVersion}`, name: a.displayName, kind: `${a.kind} agent`, build: (o: string) => agentCreateArgs({ ...a, ownerWallet: o }, drafts.ttlDays) })),
          ].map((d) => (
            <div key={d.key} className="pub-row">
              <div>
                <span className="t-card">{d.name}</span>
                <span className="muted t-small"> · {d.kind} · <span className="mono">{d.key}</span></span>
              </div>
              {published(d.key) ? (
                <span className="badge badge--real"><span className="badge__dot" aria-hidden="true" />Published</span>
              ) : (
                <button className="btn btn--secondary" type="button" disabled={!ready || busy !== null} onClick={() => publish(d.key, d.build)}>
                  {busy === d.key ? "Publishing…" : "Publish to Arkiv"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {journal.length > 0 && (
        <details className="journal">
          <summary className="t-label">Write journal ({journal.length})</summary>
          <ol>
            {journal.slice(-20).reverse().map((e, i) => (
              <li key={i} className="mono t-small">
                {e.at.slice(11, 19)} {e.key} {e.phase}{" "}
                {e.txHash && (
                  <a className="link" href={`${ARKIV_EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                    {e.txHash.slice(0, 12)}…
                  </a>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="t-small muted">
        After publishing, add your wallet address to <span className="mono">ARKIV_TRUSTED_PUBLISHERS</span> in the API&apos;s .env. The
        marketplace only shows entities from trusted publishers, because anyone can write a schema name.
      </p>
    </div>
  );
}
