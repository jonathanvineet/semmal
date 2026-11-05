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
        statement: "Sign in to the SEMMAL admin dashboard. This is not a transaction and costs nothing.",
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
      if (!res.ok) throw new Error((await res.json()).error ?? "Sign-in failed");
      await refreshMe();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account, chainId, refreshMe]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    await refreshMe();
  }, [refreshMe]);

  /** Signed-in session belongs to a different wallet than the one currently selected. */
  const mismatch = Boolean(me?.address && account && getAddress(account) !== me.address);

  return { account, chainId, me, error, setError, connect, signIn, signOut, refreshMe, mismatch };
}
