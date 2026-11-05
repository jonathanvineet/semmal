"use client";
/**
 * Wallet-signed Arkiv writes for any page. The owner's wallet signs and broadcasts; reads go via the
 * API's read-only RPC proxy. No private key exists anywhere. Every write is one-shot, journaled in
 * this browser, and needs an in-page fee approval before the wallet opens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, parseEther } from "viem";
import { guardedWalletClient, RABDI_CHAIN_ID, walletSigner } from "@semmal/arkiv-adapter/browser";
import { provider } from "./wallet";

export const RABDI_WALLET_PARAMS = {
  chainId: "0x76edaf",
  chainName: "Rabdi (Arkiv testnet)",
  nativeCurrency: { name: "Golem", symbol: "tGLM", decimals: 18 },
  rpcUrls: ["https://rpc.rabdi.db-chain.testnet.arkiv.network"],
  blockExplorerUrls: ["https://rabdi.explorer.arkiv.network"],
};
const JOURNAL = "semmal.arkiv.journal.v1";

export type Approval = { key: string; gas: bigint; gasPrice: bigint; maximumCostWei: bigint; resolve: (ok: boolean) => void };
export type JournalEntry = { key: string; phase: string; txHash?: string; entityKey?: string; at: string };

export const readJournal = (): JournalEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL) ?? "[]");
  } catch {
    return [];
  }
};

export function useArkivWriter() {
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const client = useRef<ReturnType<typeof createPublicClient> | null>(null);

  const reader = useCallback(() => {
    if (!client.current)
      client.current = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http(`${location.origin}/api/arkiv/rpc`, { timeout: 15_000, retryCount: 0 }) });
    return client.current;
  }, []);

  useEffect(() => {
    const p = provider();
    if (!p) return;
    p.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c)));
    const on = (c: unknown) => setChainId(Number(c));
    p.on?.("chainChanged", on);
    return () => p.removeListener?.("chainChanged", on);
  }, []);

  const refreshBalance = useCallback(async (account: string | null) => {
    if (!account || chainId !== RABDI_CHAIN_ID) return setBalance(null);
    try {
      setBalance(await reader().getBalance({ address: account as `0x${string}`, blockTag: "latest" }));
    } catch {
      setBalance(null);
    }
  }, [chainId, reader]);

  const switchToRabdi = useCallback(async () => {
    const p = provider();
    if (!p) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RABDI_WALLET_PARAMS.chainId }] });
    } catch {
      await p.request({ method: "wallet_addEthereumChain", params: [RABDI_WALLET_PARAMS] });
    }
  }, []);

  const record = (e: Omit<JournalEntry, "at">) => localStorage.setItem(JOURNAL, JSON.stringify([...readJournal(), { ...e, at: new Date().toISOString() }]));

  /** One create. Throws a readable error; never resends on its own. */
  const publish = useCallback(
    async (key: string, account: string, args: { schema: unknown; values: unknown; options: unknown }, maxFeeTglm: string) => {
      const p = provider();
      if (!p) throw new Error("No browser wallet found.");
      const prior = readJournal().filter((e) => e.key === key);
      if (prior.some((e) => e.phase === "receipt_verified")) throw new Error("This exact profile is already published from this browser.");
      if (prior.some((e) => e.txHash && !prior.some((f) => f.phase === "receipt_verified" && f.txHash === e.txHash)))
        throw new Error("An earlier transaction for this profile is unconfirmed. Check it on the explorer first.");
      const budget = parseEther(maxFeeTglm);
      const w = guardedWalletClient({
        publicClient: reader(),
        signer: walletSigner(p, account),
        accessKey: "",
        maxCostWei: budget,
        journal: { record: (e) => record({ key, phase: String(e.phase), txHash: e.txHash as string | undefined, entityKey: e.entityKey as string | undefined }) },
        approve: (tx) =>
          new Promise<boolean>((resolve) => setApproval({ key, gas: tx.gas, gasPrice: tx.gasPrice, maximumCostWei: tx.maximumCostWei, resolve })),
      });
      try {
        return await w.createEntity(args.schema, args.values, args.options);
      } finally {
        setApproval(null);
      }
    },
    [reader],
  );

  /** Delete one entity the connected wallet owns. One-shot, journaled, approved in the page first. */
  const remove = useCallback(
    async (key: string, account: string, entityKey: string, maxFeeTglm: string) => {
      const p = provider();
      if (!p) throw new Error("No browser wallet found.");
      const prior = readJournal().filter((e) => e.key === key);
      if (prior.some((e) => e.txHash && !prior.some((f) => f.phase === "receipt_verified" && f.txHash === e.txHash)))
        throw new Error("An earlier delete for this entity is unconfirmed. Check it on the explorer first.");
      const w = guardedWalletClient({
        publicClient: reader(),
        signer: walletSigner(p, account),
        accessKey: "",
        maxCostWei: parseEther(maxFeeTglm),
        journal: { record: (e) => record({ key, phase: String(e.phase), txHash: e.txHash as string | undefined, entityKey }) },
        approve: (tx) =>
          new Promise<boolean>((resolve) => setApproval({ key, gas: tx.gas, gasPrice: tx.gasPrice, maximumCostWei: tx.maximumCostWei, resolve })),
      });
      try {
        return await w.deleteEntity(entityKey);
      } finally {
        setApproval(null);
      }
    },
    [reader],
  );

  return { chainId, onRabdi: chainId === RABDI_CHAIN_ID, balance, refreshBalance, switchToRabdi, publish, remove, approval };
}
