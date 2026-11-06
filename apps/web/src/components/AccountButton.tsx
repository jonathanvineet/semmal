"use client";
/** The one place to connect, sign in and sign out, in the dock on every page. */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AccountButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(w.me?.address && !w.mismatch);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn)
    return (
      <div className="acct" ref={box}>
        <button type="button" className="btn btn--secondary btn--sm acct__btn" disabled={busy} onClick={() => run(w.account ? w.signIn : w.connect)}>
          {busy ? "Check your wallet…" : !w.account ? "Connect wallet" : w.mismatch ? "Sign in again" : "Sign in"}
        </button>
        {w.error && <span className="acct__err t-small" role="status">{w.error}</span>}
      </div>
    );

  return (
    <div className="acct" ref={box}>
      <button type="button" className="btn btn--secondary btn--sm acct__btn mono" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="acct__dot" aria-hidden="true" />
        {short(w.me!.address!)}
      </button>
      {open && (
        <div className="acct__menu" role="menu">
          <p className="t-small muted">Signed in as <span className="mono">{short(w.me!.address!)}</span>{w.me!.role === "owner" ? " · instance owner" : ""}</p>
          <Link role="menuitem" href="/orders" onClick={() => setOpen(false)}>Your orders</Link>
          <Link role="menuitem" href="/admin" onClick={() => setOpen(false)}>Your dashboard</Link>
          <button role="menuitem" type="button" onClick={() => run(async () => { await w.signOut(); setOpen(false); })}>Sign out</button>
        </div>
      )}
    </div>
  );
}
