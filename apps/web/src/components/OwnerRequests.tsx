"use client";
/** Booking requests for your robots: approve before the robot moves, or decline. */
import { useCallback, useEffect, useState } from "react";
import { ROBOT_SKILLS } from "@semmal/contracts";

type Req = { taskId: string; robotId: string; robotName: string; skill: string | null; startAt: string | null; distanceKm: number | null; offer: string | null; state: string; detail: string | null; at: string | null };
const LABEL: Record<string, string> = {
  AWAITING_OWNER: "Waiting for you", APPROVED: "Approved", TRAVELLING: "On the way", ARRIVED: "Arrived", AWAITING_CONFIRMATION: "Waiting for the customer to confirm",
  CONFIRMED: "Confirmed", AWAITING_PAYMENT: "Waiting for payment", PAID: "Paid", EXECUTING: "Working", COMPLETED: "Done", ABORTED: "Ended", SAFE_STOP: "Stopped safely", FAILED: "Could not finish",
};

export function OwnerRequests() {
  const [items, setItems] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/owner/requests", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items)).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  const decide = async (taskId: string, approved: boolean) => {
    setBusy(taskId);
    setMsg(null);
    const r = await fetch(`/api/tasks/${taskId}/approve`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved }) });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? (approved ? "Approved: the robot sets off on time." : "Declined.") : d.error ?? "Failed");
    setBusy(null);
    load();
  };
  if (!items || items.length === 0) return null;
  return (
    <article className="card integ span-12 orq">
      <div className="integ__head">
        <h3 className="t-card">Booking requests</h3>
        <span className="t-small muted">A robot only moves after you approve</span>
      </div>
      {msg && <p className="t-small notice">{msg}</p>}
      <ul className="orq__list">
        {items.map((q) => (
          <li key={q.taskId} className={q.state === "AWAITING_OWNER" ? "is-new" : ""}>
            <span className="orq__main">
              <b>{q.robotName}</b>
              <span className="t-small muted">
                {ROBOT_SKILLS.find((x) => x.id === q.skill)?.label ?? q.skill ?? "Job"}
                {q.startAt ? ` · on site ${new Date(q.startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                {q.distanceKm !== null ? ` · about ${q.distanceKm} km from its base` : ""}
                {q.offer ? ` · offer ${q.offer} 0G` : ""}
              </span>
            </span>
            {q.state === "AWAITING_OWNER" ? (
              <span className="orq__actions">
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy === q.taskId} onClick={() => decide(q.taskId, false)}>Decline</button>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy === q.taskId} onClick={() => decide(q.taskId, true)}>Approve</button>
              </span>
            ) : (
              <span className="t-small muted">{LABEL[q.state] ?? q.state}</span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}
