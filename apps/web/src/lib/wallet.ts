"use client";
/** Browser wallet (EIP-1193) + Sign-In With Ethereum. The wallet signs a text message; no key leaves it. */
import { useCallback, useEffect, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { getAddress } from "viem";

export type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (e: string, f: (v: unknown) => void) => void;
  removeListener?: (e: string, f: (v: unknown) => void) => void;
};
export type Me = { address: string | null; role: "owner" | "admin" | "none"; ownerSet: boolean };

export const RABDI_CHAIN_ID = 7794095;

/**
 * Per-tab sign-in: each tab keeps its own session id (sessionStorage) and sends it with its API calls,
 * so two tabs can be signed in as two different wallets at once. Without one, the browser cookie is used.
 */
const TAB_SID = "semmal:sid";
if (typeof window !== "undefined" && !(window as { __semmalTabSession?: boolean }).__semmalTabSession) {
  (window as { __semmalTabSession?: boolean }).__semmalTabSession = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const sid = sessionStorage.getItem(TAB_SID);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (sid && (url.startsWith("/api/") || url.startsWith(`${location.origin}/api/`))) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-semmal-session", sid);
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
}
export const provider = () => (globalThis as { ethereum?: Eip1193 }).ethereum;

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await (await fetch("/api/auth/me", { credentials: "same-origin" })).json());
    } catch {
      setError("The SEMMAL API is not reachable.");
    }
  }, []);

  useEffect(() => {
    refreshMe();
    const p = provider();
    if (!p) return;
    p.request({ method: "eth_accounts" }).then((a) => setAccount(((a as string[])[0]) ?? null));
    p.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c)));
    const onAcc = (a: unknown) => setAccount(((a as string[])[0]) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c));
    p.on?.("accountsChanged", onAcc);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAcc);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [refreshMe]);

  const connect = useCallback(async () => {
    setError(null);
    const p = provider();
    if (!p) return setError("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
    const a = (await p.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(a[0] ?? null);
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const p = provider();
    if (!p || !account) return;
    try {
      const { nonce } = await (await fetch("/api/auth/nonce")).json();
      const message = createSiweMessage({
        address: getAddress(account),
        chainId: chainId ?? RABDI_CHAIN_ID,
        domain: location.host,
        uri: location.origin,
        version: "1",
        nonce,
        statement: "Sign in to your SEMMAL dashboard. This is not a transaction and costs nothing.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 5 * 60 * 1000),
      });
      const signature = (await p.request({ method: "personal_sign", params: [message, account] })) as string;
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Sign-in failed");
      if (d.sid) sessionStorage.setItem(TAB_SID, d.sid); // this tab keeps this wallet's session
      await refreshMe();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account, chainId, refreshMe]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    sessionStorage.removeItem(TAB_SID);
    await refreshMe();
  }, [refreshMe]);

  /** Signed-in session belongs to a different wallet than the one currently selected. */
  const mismatch = Boolean(me?.address && account && getAddress(account) !== me.address);

  return { account, chainId, me, error, setError, connect, signIn, signOut, refreshMe, mismatch };
}
