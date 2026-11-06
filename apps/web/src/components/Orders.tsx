"use client";
/**
 * The signed-in wallet's bookings, newest first. Each order shows the robot, the job, when it was booked
 * and when it is due on site, the robot's offer and the live status it reported. Opening one shows the
 * booking view (pay the offer, the route and the robot on the map, progress).
 */
import Link from "next/link";
import { arkivEntity } from "@/lib/explorers";
import { ExplorerLink } from "./ui/ExplorerLink";
import { useCallback, useEffect, useState } from "react";
import { HARDWARE, ROBOT_MODELS, ROBOT_SKILLS } from "@semmal/contracts";
import { useWallet } from "@/lib/wallet";
import type { Listing, RobotProfile } from "@/lib/api";
import { BookTask } from "./BookTask";

type Order = {
  taskId: string; entityKey?: string; robotId: string; robotName: string; robotModel: string | null; skill: string; maxBudget: string;
  createdAt: string | null; startAt: string | null; deadline: string;
  offer: { amount: string; validUntil: string } | null; state: string | null;
  latest: { phase: string; etaAt: string | null; remainingM: number | null } | null;
  lastEvent: { at: string; kind: string; detail: string } | null;
};

const STATUS: Record<string, { label: string; tone: "wait" | "go" | "done" | "bad" }> = {
  TASK_RECEIVED: { label: "Sent to the robot", tone: "wait" },
  VALIDATING: { label: "Robot is checking it", tone: "wait" },
  PLANNING: { label: "Robot is planning", tone: "wait" },
  AWAITING_OWNER: { label: "Waiting for the owner to approve", tone: "wait" },
  APPROVED: { label: "Approved, getting ready", tone: "go" },
  AWAITING_CONFIRMATION: { label: "Arrived: confirm it's here", tone: "wait" },
  CONFIRMED: { label: "Confirmed", tone: "go" },
  AWAITING_PAYMENT: { label: "Pay to start", tone: "wait" },
  PAID: { label: "Paid, starting", tone: "go" },
  TRAVELLING: { label: "On the way", tone: "go" },
  ARRIVED: { label: "Arrived", tone: "go" },
  DISCOVERING_SPECIALISTS: { label: "Working", tone: "go" },
  HIRING_SPECIALISTS: { label: "Working", tone: "go" },
  EXECUTING: { label: "Working", tone: "go" },
  VERIFYING: { label: "Working", tone: "go" },
  WAITING_FOR_0G: { label: "Waiting on its vision check", tone: "wait" },
  COMPLETED: { label: "Done", tone: "done" },
  SAFE_STOP: { label: "Stopped safely", tone: "bad" },
  FAILED: { label: "Could not finish", tone: "bad" },
  ABORTED: { label: "Stopped", tone: "bad" },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const skillName = (s: string) => ROBOT_SKILLS.find((x) => x.id === s)?.label ?? s;
const modelName = (m: string | null) => HARDWARE.find((x) => x.id === m)?.name ?? ROBOT_MODELS.find((x) => x.id === m)?.name ?? "Robot";

function status(o: Order) {
  if (o.latest?.phase === "WAITING") return { label: "Waiting at its base", tone: "wait" as const };
  if (o.latest?.phase === "TRAVELLING") return { label: `On the way${o.latest.etaAt ? `, about ${new Date(o.latest.etaAt).toLocaleTimeString(undefined, { timeStyle: "short" })}` : ""}`, tone: "go" as const };
  if (o.state && STATUS[o.state]) return STATUS[o.state]!;
  if (Date.parse(o.deadline) < Date.now()) return { label: "Past its deadline", tone: "bad" as const };
  return { label: "No update from the robot yet", tone: "wait" as const };
}

export function Orders() {
  const w = useWallet();
  const signedIn = Boolean(w.me?.address && !w.mismatch);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [robots, setRobots] = useState<RobotProfile[]>([]);

  const load = useCallback(async () => {
    if (!signedIn) return;
    const r = await fetch("/api/orders", { credentials: "same-origin" }).catch(() => null);
    if (!r) return setErr("The SEMMAL API is not reachable.");
    const d = await r.json();
    if (!r.ok) return setErr(d.error ?? "Could not load your orders");
    setErr(null);
    setOrders(d.items);
  }, [signedIn]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/robots").then((r) => r.json()).then((d: Listing<RobotProfile>) => setRobots(d.items.map((i) => i.data))).catch(() => undefined);
  }, []);

  if (!signedIn)
    return (
      <div className="empty">
        <h3 className="t-card">Sign in to see your orders</h3>
        <p className="muted">Your orders are the bookings your wallet made. Sign in with that wallet using the account button at the top.</p>
      </div>
    );
  if (err) return <p className="notice">{err}</p>;
  if (!orders) return <div className="orders orders--loading" aria-busy="true" />;
  if (orders.length === 0)
    return (
      <div className="empty">
        <h3 className="t-card">No orders yet</h3>
        <p className="muted">Book a robot near you and it shows up here.</p>
        <Link className="btn btn--primary" href="/quote">Find a robot</Link>
      </div>
    );

  return (
    <ul className="orders">
      {orders.map((o) => {
        const s = status(o);
        const r = robots.find((x) => x.robotId === o.robotId);
        const isOpen = open === o.taskId;
        return (
          <li key={o.taskId} className={`order ${isOpen ? "is-open" : ""}`}>
            <button type="button" className="order__row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : o.taskId)}>
              <span className="order__main">
                <b>{o.robotName}</b>
                <span className="muted t-small">{modelName(o.robotModel)} · {skillName(o.skill)}</span>
              </span>
              <span className="order__when">
                <span className="t-small muted">Booked</span>
                <span>{when(o.createdAt)}</span>
              </span>
              <span className="order__when">
                <span className="t-small muted">On site</span>
                <span>{when(o.startAt)}</span>
              </span>
              <span className="order__when">
                <span className="t-small muted">{o.offer ? "Offer" : "Budget"}</span>
                <span className="mono">{o.offer ? o.offer.amount : `up to ${o.maxBudget}`} 0G</span>
              </span>
              <span className={`order__status order__status--${s.tone}`}>{s.label}</span>
            </button>
            {isOpen && (
              <div className="order__detail">
                <BookTask
                  resume={o.taskId}
                  robotId={o.robotId}
                  robotName={o.robotName}
                  robotBase={r?.location ?? null}
                  site={null}
                  area={r?.serviceArea ?? ""}
                  plan={{ skill: o.skill, waypoints: 1, distanceM: 0, privacy: "private" }}
                  quote={o.offer?.amount ?? o.maxBudget}
                />
                <p className="t-small muted mono">{o.taskId}{o.lastEvent ? ` · last update ${new Date(o.lastEvent.at).toLocaleTimeString()}` : ""}{o.entityKey ? <> · booking <ExplorerLink href={arkivEntity(o.entityKey)} value={o.entityKey} /></> : null}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
