"use client";
/** Browser wallet (EIP-1193) + Sign-In With Ethereum. The wallet signs a text message; no key leaves it. */
import { useEffect, useSyncExternalStore } from "react";
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

/**
 * One wallet and sign-in state for the whole page: every component (the dock's account button, the bell,
 * Your orders, the dashboard) reads and updates the same store, so signing in anywhere shows everywhere.
 */
type WalletState = { account: string | null; chainId: number | null; me: Me | null; error: string | null };
const EMPTY: WalletState = { account: null, chainId: null, me: null, error: null };
let state: WalletState = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<WalletState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function refreshMe() {
  try {
    set({ me: await (await fetch("/api/auth/me", { credentials: "same-origin" })).json() });
  } catch {
    set({ error: "The SEMMAL API is not reachable." });
  }
}

let started = false;
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  refreshMe();
  const p = provider();
  if (!p) return;
  p.request({ method: "eth_accounts" }).then((a) => set({ account: ((a as string[])[0]) ?? null }));
  p.request({ method: "eth_chainId" }).then((c) => set({ chainId: Number(c) }));
  p.on?.("accountsChanged", (a: unknown) => set({ account: ((a as string[])[0]) ?? null }));
  p.on?.("chainChanged", (c: unknown) => set({ chainId: Number(c) }));
}

async function connect() {
  set({ error: null });
  const p = provider();
  if (!p) return set({ error: "No browser wallet found. Install MetaMask or another EIP-1193 wallet." });
  try {
    const a = (await p.request({ method: "eth_requestAccounts" })) as string[];
    set({ account: a[0] ?? null });
  } catch (e) {
    set({ error: (e as Error).message });
  }
}

async function signIn() {
  set({ error: null });
  const p = provider();
  if (!p) return set({ error: "No browser wallet found." });
  let account = state.account;
  if (!account) {
    await connect();
    account = state.account;
    if (!account) return;
  }
  try {
    const { nonce } = await (await fetch("/api/auth/nonce")).json();
    const message = createSiweMessage({
      address: getAddress(account),
      chainId: state.chainId ?? RABDI_CHAIN_ID,
      domain: location.host,
      uri: location.origin,
      version: "1",
      nonce,
      statement: "Sign in to SEMMAL. This is not a transaction and costs nothing.",
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
    set({ error: (e as Error).message });
  }
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  sessionStorage.removeItem(TAB_SID);
  await refreshMe();
}

const setError = (error: string | null) => set({ error });

export function useWallet() {
  const s = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(start, []);
  /** Signed-in session belongs to a different wallet than the one currently selected. */
  const mismatch = Boolean(s.me?.address && s.account && getAddress(s.account) !== s.me.address);
  return { ...s, setError, connect, signIn, signOut, refreshMe, mismatch };
}
