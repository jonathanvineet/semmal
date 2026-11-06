"use client";
/**
 * Book the quoted job: your wallet puts the booking on Arkiv (expires at its deadline, budget capped
 * at the quote), the platform dispatches it to the robot, and this panel follows it: the robot's own
 * signed offer, the agents it hires, and its progress.
 */
import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { taskRequestCreateArgs } from "@semmal/arkiv-adapter/browser";
import { useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ApprovalCard } from "./ui/ApprovalCard";

type Plan = { skill: string; waypoints: number; distanceM: number; privacy: "private" | "verified" | "standard" };
type TaskView = {
  quotes: { data: { quoteId: string; amount: string; validUntil: string } }[];
  claims: { data: { jobId: string; agentId: string; price: string } }[];
  events: { at: string; kind: string; detail: string }[];
  robot: { online: boolean; availability: string };
};

const DEADLINES = [
  { h: 1, label: "Within 1 hour" },
  { h: 4, label: "Within 4 hours" },
  { h: 24, label: "Within a day" },
];

export function BookTask({ robotId, area, plan, quote }: { robotId: string; area: string; plan: Plan; quote: string }) {
  const w = useWallet();
  const ark = useArkivWriter();
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [view, setView] = useState<TaskView | null>(null);
  const [dispatched, setDispatched] = useState<string | null>(null);

  // follow the task once booked
  useEffect(() => {
    if (!taskId) return;
    const load = () => fetch(`/api/tasks/${taskId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setView(d)).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [taskId]);

  const book = async () => {
    if (!w.account) return w.connect();
    if (!ark.onRabdi) return ark.switchToRabdi();
    setBusy(true);
    setErr(null);
    try {
      const id = `task-${crypto.randomUUID().slice(0, 18)}`;
      const args = taskRequestCreateArgs({
        schemaVersion: "1.0",
        taskId: id,
        customerWallet: getAddress(w.account),
        robotId,
        skill: plan.skill as never,
        plan: { waypoints: plan.waypoints, distanceM: plan.distanceM, privacy: plan.privacy },
        area,
        maxBudget: quote,
        deadline: new Date(Date.now() + hours * 3_600_000).toISOString(),
      });
      await ark.publish(`task:${id}`, w.account, args, "0.01");
      setTaskId(id);
      // Arkiv indexes in a few seconds; dispatch reads the booking back from Arkiv before sending it
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const r = await fetch(`/api/tasks/${id}/dispatch`, { method: "POST" });
        const d = await r.json();
        if (r.ok) { setDispatched("Sent to the robot."); break; }
        if (r.status !== 404) { setDispatched(d.error); break; }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (taskId)
    return (
      <div className="bk">
        <div className="bk__head">
          <span className="t-label muted">Booked on Arkiv</span>
          <span className="mono t-small">{taskId}</span>
        </div>
        {dispatched && <p className="t-small muted">{dispatched}</p>}
        <ol className="bk__steps">
          <li className={view?.robot.online ? "is-done" : ""}>Robot {view?.robot.online ? `online (${view.robot.availability})` : "offline"}</li>
          <li className={view?.quotes.length ? "is-done" : ""}>
            {view?.quotes.length ? `Robot's signed offer: ${view.quotes[0]!.data.amount} USDC` : "Waiting for the robot's signed offer"}
          </li>
          <li className={view?.claims.length ? "is-done" : ""}>
            {view?.claims.length ? `Hired ${view.claims.map((c) => c.data.agentId).join(", ")}` : "Waiting for the robot to hire agents"}
          </li>
        </ol>
        {view && view.events.length > 0 && (
          <ol className="rl__log">
            {view.events.slice(0, 6).map((e, i) => (
              <li key={i}><span className="mono muted">{e.at.slice(11, 19)}</span><span className={`rl__kind rl__kind--${e.kind}`}>{e.kind}</span><span>{e.detail}</span></li>
            ))}
          </ol>
        )}
      </div>
    );

  return (
    <div className="bk">
      <div className="chip-row">
        {DEADLINES.map((d) => (
          <button key={d.h} type="button" className={`pill-opt ${hours === d.h ? "is-on" : ""}`} aria-pressed={hours === d.h} onClick={() => setHours(d.h)}>{d.label}</button>
        ))}
      </div>
      {ark.approval && (
        <ApprovalCard
          what={`Booking · ${ark.approval.key}`}
          account={w.account}
          gas={ark.approval.gas}
          gasPrice={ark.approval.gasPrice}
          maximumCostWei={ark.approval.maximumCostWei}
          onApprove={() => ark.approval!.resolve(true)}
          onCancel={() => ark.approval!.resolve(false)}
        />
      )}
      {err && <p className="soft-warn">{err}</p>}
      <button type="button" className="btn btn--primary" disabled={busy} onClick={book}>
        {!w.account ? "Connect wallet to book" : !ark.onRabdi ? "Switch to Rabdi to book" : busy ? "Booking…" : `Book this job, up to ${quote} USDC`}
      </button>
      <p className="t-small muted">Your wallet signs the booking. It expires on Arkiv at its deadline. No payment is taken yet.</p>
    </div>
  );
}
