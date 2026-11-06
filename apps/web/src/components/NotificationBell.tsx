"use client";
/**
 * Notifications for the signed-in wallet: robot owners hear about bookings, payments, arrivals and
 * stops; customers about offers, the trip, the arrival and the result. Polls every 10 s; new ones
 * also show as browser notifications if you allow them.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";

type Item = { id: number; taskId: string; kind: string; title: string; body: string; audience: "owner" | "customer"; at: string; read: boolean };

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

export function NotificationBell() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(w.me?.address && !w.mismatch);

  useEffect(() => setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission), []);

  const load = useCallback(async () => {
    if (!signedIn) return;
    const r = await fetch("/api/notifications", { credentials: "same-origin" }).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { items: Item[]; unread: number };
    setItems(d.items);
    setUnread(d.unread);
    // pop new ones as browser notifications (not the backlog on first load)
    const newest = d.items[0]?.id ?? 0;
    if (seen.current !== null && typeof Notification !== "undefined" && Notification.permission === "granted")
      d.items.filter((i) => i.id > seen.current! && !i.read).reverse().forEach((i) => new Notification(i.title, { body: i.body, tag: `semmal-${i.id}` }));
    seen.current = Math.max(seen.current ?? 0, newest);
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    seen.current = null;
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [signedIn, load]);

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

  const markAll = async () => {
    await fetch("/api/notifications/read", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    load();
  };
  const markOne = async (id: number) => {
    await fetch("/api/notifications/read", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    load();
  };

  return (
    <div className="nb" ref={box}>
      <button type="button" className="dock__btn nb__btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unread > 0 && <span className="nb__count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="nb__panel" role="dialog" aria-label="Notifications">
          <div className="nb__head">
            <b>Notifications</b>
            {signedIn && unread > 0 && <button type="button" className="link t-small" onClick={markAll}>Mark all read</button>}
          </div>
          {!signedIn ? (
            <div className="nb__empty">
              <p className="t-small muted">Sign in with your wallet to hear about bookings for your robots, and about robots you booked: offers, the trip, arrival and the result.</p>
              {!w.account ? (
                <button type="button" className="btn btn--primary btn--sm" onClick={w.connect}>Connect wallet</button>
              ) : (
                <button type="button" className="btn btn--primary btn--sm" onClick={w.signIn}>Sign in</button>
              )}
              {w.error && <p className="t-small soft-warn">{w.error}</p>}
            </div>
          ) : items.length === 0 ? (
            <p className="t-small muted nb__empty">Nothing yet. Book a robot or register one to start getting updates.</p>
          ) : (
            <ul className="nb__list">
              {items.map((i) => (
                <li key={i.id} className={i.read ? "" : "is-new"}>
                  <button type="button" className="nb__item" onClick={() => markOne(i.id)}>
                    <span className="nb__who">{i.audience === "owner" ? "Your robot" : "Your booking"} · {ago(i.at)}</span>
                    <b>{i.title}</b>
                    <span className="t-small muted">{i.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {signedIn && (
            <div className="nb__foot">
              {perm === "default" && <button type="button" className="link t-small" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on desktop alerts</button>}
              {perm === "denied" && <span className="t-small muted">Desktop alerts are blocked in this browser.</span>}
              {perm === "granted" && <span className="t-small muted">Desktop alerts are on.</span>}
              <Link className="link t-small" href="/admin" onClick={() => setOpen(false)}>Your robots</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
