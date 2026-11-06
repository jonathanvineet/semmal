"use client";
/**
 * Book the quoted job: your wallet puts the booking on Arkiv (expires at its deadline, budget capped
 * at the quote), the platform dispatches it to the robot, the robot publishes its own signed offer,
 * and you pay that offer in 0G from your wallet straight to the robot's wallet (0G Galileo). The
 * robot checks the payment on chain itself, then hires and pays its agents and does the job.
 * The platform never holds the money.
 */
import { useEffect, useState } from "react";
import { getAddress, parseEther, toHex } from "viem";
import { GALILEO_CHAIN_ID, GALILEO_RPC, GALILEO_EXPLORER, memo } from "@semmal/zerog-pay";
import { taskRequestCreateArgs } from "@semmal/arkiv-adapter/browser";
import { provider, useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ApprovalCard } from "./ui/ApprovalCard";

type Plan = { skill: string; waypoints: number; distanceM: number; privacy: "private" | "verified" | "standard" };
type TaskView = {
  quotes: { data: { quoteId: string; amount: string; validUntil: string; robotWallet: string } }[];
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
  const [payTx, setPayTx] = useState<string | null>(null);
  const [confirmPay, setConfirmPay] = useState(false);

  /** Pay the robot's offer from the customer's own wallet: a plain 0G transfer on Galileo with the quote's memo. */
  const pay = async (q: TaskView["quotes"][number]["data"]) => {
    const p = provider();
    if (!p || !w.account || !taskId) return;
    setErr(null);
    setBusy(true);
    try {
      const hexId = toHex(GALILEO_CHAIN_ID);
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hexId, chainName: "0G Galileo Testnet", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: [GALILEO_RPC], blockExplorerUrls: [GALILEO_EXPLORER] }],
        });
      }
      const hash = (await p.request({
        method: "eth_sendTransaction",
        params: [{ from: w.account, to: getAddress(q.robotWallet), value: toHex(parseEther(q.amount)), data: memo("quote", q.quoteId) }],
      })) as string;
      setPayTx(hash);
      setConfirmPay(false);
      const r = await fetch(`/api/tasks/${taskId}/payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
      if (!r.ok) setErr((await r.json()).error ?? "Could not tell the robot about the payment");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  if (taskId) {
    const offer = view?.quotes[0]?.data;
    const has = (state: string) => Boolean(view?.events.some((e) => e.detail.includes(`: ${state}`)));
    const expired = offer ? Date.parse(offer.validUntil) <= Date.now() : false;
    return (
      <div className="bk">
        <div className="bk__head">
          <span className="t-label muted">Booked on Arkiv</span>
          <span className="mono t-small">{taskId}</span>
        </div>
        {dispatched && <p className="t-small muted">{dispatched}</p>}
        <ol className="bk__steps">
          <li className={view?.robot.online ? "is-done" : ""}>Robot {view?.robot.online ? `online (${view.robot.availability})` : "offline"}</li>
          <li className={offer ? "is-done" : ""}>
            {offer ? `Robot's signed offer: ${offer.amount} 0G, valid until ${offer.validUntil.slice(11, 16)}` : "Waiting for the robot's signed offer"}
          </li>
          <li className={has("PAID") ? "is-done" : ""}>
            {has("PAID") ? "The robot checked your payment on chain" : payTx ? "Payment sent; the robot is checking it on chain" : "Pay the offer from your wallet"}
          </li>
          <li className={view?.claims.length ? "is-done" : ""}>
            {view?.claims.length ? `Hired ${view.claims.map((c) => c.data.agentId).join(", ")}` : "Waiting for the robot to hire agents"}
          </li>
        </ol>
        {offer && !payTx && !has("PAID") && !expired && (
          confirmPay ? (
            <div className="bk__pay">
              <p className="t-small">
                You pay <b>{offer.amount} 0G</b> on 0G Galileo from <span className="mono">{w.account}</span> to the robot&apos;s wallet{" "}
                <span className="mono">{offer.robotWallet}</span>, with the memo for offer <span className="mono">{offer.quoteId}</span>. Your wallet asks you to confirm.
                If the robot cannot finish, it sends back what it did not spend.
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => pay(offer)}>{busy ? "Waiting for your wallet…" : `Pay ${offer.amount} 0G`}</button>
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirmPay(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => (w.account ? setConfirmPay(true) : w.connect())}>Pay {offer.amount} 0G to the robot</button>
          )
        )}
        {offer && expired && !has("PAID") && <p className="soft-warn t-small">The robot&apos;s offer expired before it was paid. Book again for a fresh offer.</p>}
        {payTx && <p className="t-small muted">Payment <span className="mono">{payTx}</span></p>}
        {err && <p className="soft-warn">{err}</p>}
        {view && view.events.length > 0 && (
          <ol className="rl__log">
            {view.events.slice(0, 6).map((e, i) => (
              <li key={i}><span className="mono muted">{e.at.slice(11, 19)}</span><span className={`rl__kind rl__kind--${e.kind}`}>{e.kind}</span><span>{e.detail}</span></li>
            ))}
          </ol>
        )}
      </div>
    );
  }

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
        {!w.account ? "Connect wallet to book" : !ark.onRabdi ? "Switch to Rabdi to book" : busy ? "Booking…" : `Book this job, up to ${quote} 0G`}
      </button>
      <p className="t-small muted">Your wallet signs the booking. It expires on Arkiv at its deadline. Then the robot sends its signed offer and you pay it in 0G from your wallet.</p>
    </div>
  );
}
