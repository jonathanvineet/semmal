"use client";
/**
 * Book the quoted job: your wallet puts the booking on Arkiv (expires at its deadline, budget capped
 * at the quote), the platform dispatches it to the robot, the robot publishes its own signed offer,
 * and you pay that offer in 0G from your wallet straight to the robot's wallet (0G Galileo). The
 * robot checks the payment on chain itself, then hires and pays its agents and does the job.
 * The platform never holds the money.
 */
import { useEffect, useState } from "react";
import { arkivAddress, arkivEntity, arkivTx, galileoAddress, galileoTx } from "@/lib/explorers";
import { ExplorerLink } from "./ui/ExplorerLink";
import { getAddress, parseEther, toHex } from "viem";
import { GALILEO_CHAIN_ID, GALILEO_RPC, GALILEO_EXPLORER, memo } from "@semmal/zerog-pay";
import { taskRequestCreateArgs } from "@semmal/arkiv-adapter/browser";
import { provider, useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ApprovalCard } from "./ui/ApprovalCard";
import { MapView, type Pt } from "./map/MapView";
import { ComputeView } from "./ComputeView";

type Plan = { skill: string; waypoints: number; distanceM: number; privacy: "private" | "verified" | "standard" };
type TaskView = {
  quotes: { data: { quoteId: string; amount: string; validUntil: string; robotWallet: string } }[];
  claims: { data: { jobId: string; agentId: string; price: string } }[];
  events: { at: string; kind: string; detail: string }[];
  robot: { online: boolean; availability: string };
  liveOffer?: { quoteId: string; amount: string; validUntil: string; robotWallet: string } | null;
  state?: { state: string; detail?: string; at: string } | null;
};
/** The booking flow, in order: the robot's states that mean each step is done. */
const FLOW = ["AWAITING_OWNER", "APPROVED", "TRAVELLING", "ARRIVED", "AWAITING_CONFIRMATION", "CONFIRMED", "AWAITING_PAYMENT", "PAID", "DISCOVERING_SPECIALISTS", "HIRING_SPECIALISTS", "EXECUTING", "VERIFYING", "WAITING_FOR_0G", "COMPLETED"];

const DEADLINES = [
  { h: 1, label: "Done within 1 hour" },
  { h: 4, label: "Within 4 hours" },
  { h: 24, label: "Within a day" },
];
type Track = { site: Pt | null; startAt: string | null; latest: { lat: number; lon: number; phase: string; etaAt?: string; remainingM?: number } | null; route: { source: string; coords: [number, number][]; distanceM: number; durationS: number } | null };
/** datetime-local value in the browser's time zone */
const localInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function BookTask({ robotId, robotName, robotBase, site, area, plan, quote, resume }: { robotId: string; robotName: string; robotBase: Pt | null; site: Pt | null; area: string; plan: Plan; quote: string; resume?: string }) {
  const w = useWallet();
  const ark = useArkivWriter();
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // resume: open an existing order (from Your orders) straight in its tracking view
  const [taskId, setTaskId] = useState<string | null>(resume ?? null);
  const [view, setView] = useState<TaskView | null>(null);
  // what happened when the booking was sent to the robot (null: not tried yet in this page)
  const [dispatched, setDispatched] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [payTx, setPayTx] = useState<string | null>(null);
  const [bookingTx, setBookingTx] = useState<string | null>(null);
  // delivery: how long the drive takes decides the earliest time the robot can be on site
  const [drive, setDrive] = useState<{ durationS: number; distanceM: number; source: string } | null>(null);
  const [startAt, setStartAt] = useState("");
  // as soon as possible: no on-site time, the robot leaves the moment its owner approves
  const [asap, setAsap] = useState(false);
  const [ffBusy, setFfBusy] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const earliest = Date.now() + ((drive?.durationS ?? 0) + 15 * 60) * 1000; // drive + offer, payment and loading
  useEffect(() => {
    if (!site || !robotBase) return setDrive(null);
    fetch(`/api/route?from=${robotBase.lat},${robotBase.lon}&to=${site.lat},${site.lon}`)
      .then((r) => r.json())
      .then((d) => d.durationS !== undefined && setDrive({ durationS: d.durationS, distanceM: d.distanceM, source: d.source }))
      .catch(() => setDrive(null));
  }, [site, robotBase]);
  useEffect(() => {
    if (drive && (!startAt || Date.parse(startAt) < earliest)) setStartAt(localInput(Math.ceil(earliest / 300_000) * 300_000));
  }, [drive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!taskId) return;
    const load = () => fetch(`/api/tasks/${taskId}/track`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTrack(d)).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [taskId]);
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

  /** Send the booking to the robot through the platform. The site goes this way, never onto Arkiv. */
  const dispatch = async (id: string) => {
    setSending(true);
    setDispatched(null);
    try {
      // Arkiv indexes in a few seconds (longer when its public endpoint is busy); dispatch reads the booking back first
      for (let i = 0; i < 24; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2500));
        const r = await fetch(`/api/tasks/${id}/dispatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(site ? { site } : {}) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) return setDispatched({ ok: true, text: "Sent to the robot." });
        if (r.status !== 404) return setDispatched({ ok: false, text: d.error ?? `The platform answered ${r.status}` });
      }
      setDispatched({ ok: false, text: "Arkiv has not shown the booking yet, so it could not be sent. Try again in a moment." });
    } catch (e) {
      setDispatched({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const book = async () => {
    if (!w.account) return w.connect();
    if (!ark.onRabdi) return ark.switchToRabdi();
    setBusy(true);
    setErr(null);
    try {
      const id = `task-${crypto.randomUUID().slice(0, 18)}`;
      const start = !asap && startAt ? new Date(startAt).getTime() : Date.now();
      if (!asap && site && robotBase && start < earliest - 60_000) throw new Error("Pick a later time, or choose As soon as possible.");
      const args = taskRequestCreateArgs({
        schemaVersion: "1.0",
        taskId: id,
        customerWallet: getAddress(w.account),
        robotId,
        skill: plan.skill as never,
        plan: { waypoints: plan.waypoints, distanceM: plan.distanceM, privacy: plan.privacy },
        area,
        maxBudget: quote,
        deadline: new Date(start + hours * 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
        ...(!asap && startAt ? { startAt: new Date(start).toISOString() } : {}),
      });
      const res = await ark.publish(`task:${id}`, w.account, args, "0.01");
      setBookingTx(res.txHash);
      setTaskId(id);
      await dispatch(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (taskId) {
    const offer = view?.quotes[0]?.data ?? view?.liveOffer ?? undefined;
    const has = (state: string) => Boolean(view?.events.some((e) => e.detail.includes(`: ${state}`)));
    // how far along the flow the robot is (from its latest reported state)
    const now = view?.state?.state ?? null;
    const at = now ? FLOW.indexOf(now) : -1;
    const past = (state: string) => at >= FLOW.indexOf(state) && at >= 0;
    const ended = now === "ABORTED" || now === "FAILED" || now === "SAFE_STOP";
    const fastForward = async () => {
      setErr(null);
      setFfBusy(true);
      const r = await fetch(`/api/tasks/${taskId}/fast-forward`, { method: "POST", credentials: "same-origin" });
      if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Could not fast-forward");
      setTimeout(() => setFfBusy(false), 4000);
    };
    const confirmArrival = async () => {
      setErr(null);
      const r = await fetch(`/api/tasks/${taskId}/confirm-arrival`, { method: "POST", credentials: "same-origin" });
      if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Could not confirm. Sign in with the wallet that booked.");
    };
    const expired = offer ? Date.parse(offer.validUntil) <= Date.now() : false;
    return (
      <div className="bk">
        <div className="bk__head">
          <span className="t-label muted">Booked on Arkiv</span>
          <span className="mono t-small">{taskId}{bookingTx ? <> · <ExplorerLink href={arkivTx(bookingTx)} value={bookingTx} label="booking on Arkiv" /></> : null}</span>
        </div>
        {dispatched?.ok && <p className="t-small muted">{dispatched.text}</p>}
        {/* not with the robot yet: no state, quote or event from it. Say so and offer to send it again. */}
        {!view?.state && !view?.quotes.length && !view?.events.length && (dispatched ? !dispatched.ok : view !== null && !sending) && (
          <div className="notice">
            <p className="t-small">
              {dispatched && !dispatched.ok ? <>Not sent to the robot: {dispatched.text}</> : <>The robot has not received this booking yet.</>}
            </p>
            <button type="button" className="btn btn--secondary btn--sm" disabled={sending} onClick={() => dispatch(taskId)}>
              {sending ? "Sending…" : "Send to the robot again"}
            </button>
          </div>
        )}
        <ol className="bk__steps">
          <li className={view?.robot.online ? "is-done" : ""}>Robot {view?.robot.online ? `online (${view.robot.availability})` : "offline"}{offer ? ` · offer ${offer.amount} 0G` : ""}</li>
          <li className={past("APPROVED") ? "is-done" : ""}>{past("APPROVED") ? "The owner approved your booking" : now === "AWAITING_OWNER" ? "Waiting for the robot's owner to approve" : "The robot's owner approves the booking"}</li>
          <li className={past("ARRIVED") ? "is-done" : ""}>{past("ARRIVED") ? "The robot arrived at your site" : now === "TRAVELLING" ? "The robot is on the way (see the map)" : "The robot comes to your site"}</li>
          <li className={past("CONFIRMED") ? "is-done" : ""}>{past("CONFIRMED") ? "You confirmed it is here" : "You confirm it has arrived"}</li>
          <li className={past("PAID") ? "is-done" : ""}>{past("PAID") ? "Paid; the robot checked it on chain" : payTx ? "Payment sent; the robot is checking it" : "You pay the offer"}</li>
          <li className={past("COMPLETED") ? "is-done" : ""}>{past("COMPLETED") ? "Done" : past("DISCOVERING_SPECIALISTS") ? "The robot is working (see How it decided)" : "The robot assesses the site and does the job"}</li>
        </ol>
        {ended && <p className="soft-warn t-small">{view?.state?.detail ?? "The booking ended."}</p>}
        {now === "AWAITING_CONFIRMATION" && (
          <div className="bk__pay">
            <p className="t-small"><b>{robotName} says it has arrived.</b> Check that it is really at your site, then confirm. You pay only after you confirm.</p>
            <div className="btn-row"><button type="button" className="btn btn--primary" onClick={confirmArrival}>Yes, it&apos;s here</button></div>
          </div>
        )}
        {(site ?? track?.site) && (
          <div className="bk__track">
            <MapView
              className="bk__map"
              center={(site ?? track?.site)!}
              site={site ?? track?.site ?? null}
              route={track?.route?.coords ?? null}
              live={track?.latest ? { lat: track.latest.lat, lon: track.latest.lon, label: track.latest.phase === "WAITING" ? `${robotName} · at its base` : robotName } : null}
              robots={!track?.latest && robotBase ? [{ id: "base", label: `${robotName} · its base (about 1 km)`, ...robotBase, active: true }] : []}
              fit={[(site ?? track?.site)!, ...(track?.latest ? [{ lat: track.latest.lat, lon: track.latest.lon }] : robotBase ? [robotBase] : [])]}
            />
            <p className="t-small">
              {!track?.latest
                ? past("APPROVED")
                  ? `Approved. ${robotName} is getting ready${drive ? ` (${(drive.distanceM / 1000).toFixed(1)} km away)` : ""}.`
                  : `On site ${startAt && !asap ? new Date(startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "as soon as possible"}. ${robotName} sets off once its owner approves${drive ? `, ${(drive.distanceM / 1000).toFixed(1)} km away` : ""}.`
                : track.latest.phase === "ARRIVED"
                  ? `${robotName} is at your site.`
                  : track.latest.phase === "WAITING"
                    ? `${robotName} is at its base (${((track.latest.remainingM ?? 0) / 1000).toFixed(1)} km away). It leaves in time to arrive by ${track.latest.etaAt ? new Date(track.latest.etaAt).toLocaleTimeString(undefined, { timeStyle: "short" }) : "the booked time"}.`
                    : `${robotName} is on the way: ${((track.latest.remainingM ?? 0) / 1000).toFixed(1)} km to go${track.latest.etaAt ? `, arriving about ${new Date(track.latest.etaAt).toLocaleTimeString(undefined, { timeStyle: "short" })}` : ""}.`}
              {track?.route?.source === "straight-line" ? " (Road routing is unavailable right now, so the line is direct.)" : ""}
            </p>
            {(track?.latest?.phase === "WAITING" || track?.latest?.phase === "TRAVELLING") && (
              <div className="btn-row">
                <button type="button" className="btn btn--secondary btn--sm" disabled={ffBusy} onClick={fastForward}>
                  {ffBusy ? "Fast-forwarding…" : "Fast-forward the trip"}
                </button>
                <span className="t-small muted">Development: the robot leaves now and arrives in a few seconds.</span>
              </div>
            )}
          </div>
        )}
        {offer && now === "AWAITING_PAYMENT" && !payTx && !has("PAID") && !expired && (
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
        {payTx && <p className="t-small muted">Your payment on 0G Galileo: <ExplorerLink href={galileoTx(payTx)} value={payTx} /></p>}
        {offer && <p className="t-small muted">Robot wallet: <ExplorerLink href={galileoAddress(offer.robotWallet)} value={offer.robotWallet} n={6} /> (0G Galileo) · <ExplorerLink href={arkivAddress(offer.robotWallet)} value={offer.robotWallet} label="its records on Arkiv" /></p>}
        {err && <p className="soft-warn">{err}</p>}
        <ComputeView taskId={taskId} />
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
      {robotBase && !site && <p className="soft-warn t-small">Set your site on the map first, so the robot knows where to come.</p>}
      {site && robotBase && (
        <label className="field">
          <span className="t-label muted">On site at</span>
          <span className="chip-row">
            <button type="button" className={`pill-opt ${asap ? "is-on" : ""}`} aria-pressed={asap} onClick={() => setAsap(true)}>As soon as possible</button>
            <button type="button" className={`pill-opt ${!asap ? "is-on" : ""}`} aria-pressed={!asap} onClick={() => setAsap(false)}>At a time</button>
          </span>
          {!asap && <input type="datetime-local" value={startAt} min={localInput(earliest)} onChange={(e) => setStartAt(e.target.value)} />}
          <span className="field__hint">
            {drive ? `${(drive.distanceM / 1000).toFixed(1)} km away, about ${Math.round(drive.durationS / 60)} min by road${drive.source === "straight-line" ? " (direct estimate)" : ""}. ${asap ? "It leaves as soon as its owner approves." : `Earliest ${new Date(earliest).toLocaleTimeString(undefined, { timeStyle: "short" })}.`}` : "Working out the drive…"}
          </span>
        </label>
      )}
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
      <button type="button" className="btn btn--primary" disabled={busy || Boolean(robotBase && !site)} onClick={book}>
        {!w.account ? "Connect wallet to book" : !ark.onRabdi ? "Switch to Rabdi to book" : busy ? "Booking…" : `Book this job, up to ${quote} 0G`}
      </button>
      <p className="t-small muted">Your wallet signs the booking. It expires on Arkiv at its deadline. Then the robot sends its signed offer and you pay it in 0G from your wallet.</p>
    </div>
  );
}
