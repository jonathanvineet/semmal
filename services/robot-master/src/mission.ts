/**
 * The robot master agent's decision loop for one task. The robot decides; nobody decides for it.
 *
 *  validate -> plan stops for THIS world -> quote (own policy, live prices) -> customer pays the quote
 *  in 0G to the robot's wallet (checked on chain by the robot) -> hire agents itself, paying each
 *  agent's owner in 0G before its job -> (optional) navigation agent orders the stops -> for each
 *  stop: drive, look, ask the vision agent on 0G, check the answer, act within bounds -> return
 *  -> settle (margin to the owner if completed, otherwise what is left back to the customer)
 *  -> episode evidence (signed, 0G Storage, Arkiv)
 *
 * Money: native 0G on Galileo. Agent spend never exceeds min(quote, owner's maxSpendPerTask); an
 * owner test task (no customer) spends from the robot's own balance up to maxSpendPerTask.
 *
 * 0G is advisory and never invented: a failed or late answer holds the robot (WAITING_FOR_0G), one
 * retry, then SAFE_STOP. Safety never waits for any of this; the ROS supervisor owns it.
 * The episode records what the robot accessed and what it bought.
 */
import { randomUUID } from "node:crypto";
import { NavigationPlanOutput, VisionInspectionOutput, type AgentListing, type JobClaim, type TaskQuote } from "@semmal/contracts";
import { quoteTask, toWei, weiToMicro, type SpecialistOffer } from "@semmal/quote";
import type { TransferCheck } from "@semmal/zerog-pay";
import type { LocalApi } from "./local";
import type { PlatformApi } from "./platform";
import type { TaskState, TaskStore } from "./store";

export type Assignment = {
  taskId: string;
  skill: string;
  plan: { waypoints: number; distanceM: number; privacy: string };
  maxBudget?: string;
  deadline?: string;
  customerWallet?: string;
};

export type Decision = {
  at: string;
  checkpoint: string;
  agentId: string;
  providerRequestId?: string;
  model: string;
  trustMode: string;
  latencyMs: number;
  outcome: "accepted" | "rejected" | "failed" | "timeout";
  action: string;
  observation?: string;
  anomaly?: string | null;
  confidence?: number;
};

/** Something the robot read, captured or sent. Kept short; no image bytes, no personal data. */
export type AccessRecord = { at: string; what: string; source: string; detail: string; leftRobot: boolean };
/** Something the robot bought: the agent job, the 0G payment for it, and what came back. */
export type Purchase = {
  at: string; agentId: string; agentName: string; kind: string; forWhat: string; price0G: string; payTo?: string;
  paymentTx?: string; paymentStatus: string; status: string; providerRequestId?: string; model?: string; trustMode?: string; billing?: string;
};
export type Transfer = { to: string; amount0G: string; txHash?: string; status: string };

export type EpisodeRecord = {
  episodeId: string;
  taskId: string;
  robotId: string;
  world: string | null;
  skill: string;
  outcome: "COMPLETED" | "FAILED" | "ABORTED" | "SAFE_STOP";
  startedAt: string;
  endedAt: string;
  stops: string[];
  quote?: { quoteId: string; amount: string; cost: string; lines: { label: string; amount: string; source: string }[] };
  /** Native 0G on Galileo. */
  money: {
    token: "0G";
    funding: "customer payment" | "robot's own balance (owner test task)" | "none";
    customerPayment?: { from: string; amount0G: string; txHash: string };
    budget0G: string | null;
    agentsPaid0G: string;
    payout?: Transfer;
    refund?: Transfer;
  };
  hired: string[];
  decisions: Decision[];
  access: AccessRecord[];
  purchases: Purchase[];
  actions: { at: string; stop: string; action: string; why: string }[];
  transitions: { at: string; state: string; reason: string; actor: string }[];
  mission: unknown[];
};

export interface EvidenceSink {
  quote(q: TaskQuote): Promise<void>;
  claim(c: JobClaim): Promise<void>;
  episode(e: EpisodeRecord): Promise<void>;
}

export type Progress = (state: TaskState, taskId: string, detail?: string) => void;

/** What to do when the vision agent finds something, per kind of job. */
type OnFinding = "clean_and_continue" | "hold_and_finish" | "report_and_continue";
type SkillPlan = { candidates: string[]; home: string; onFinding: OnFinding; ask: (stop: string) => string };

/** Stops are chosen from the world's own waypoints (the gateway reports them), in this preference order. */
export const SKILL_PLANS: Record<string, SkillPlan> = {
  "home.cleaning": {
    candidates: ["kitchen", "living_room", "bedroom", "bathroom", "office", "guest_room"],
    home: "dock",
    onFinding: "clean_and_continue",
    ask: (s) => `Home cleaning check in the ${s.replace("_", " ")}. Is the floor clean? Report spills, stains or clutter on the floor.`,
  },
  "warehouse.inspection": { candidates: ["inspection_point_A"], home: "dock", onFinding: "hold_and_finish", ask: (s) => `Warehouse inspection at ${s}. Check the machine panel and its vents for obstructions or damage.` },
  "site.inspection": { candidates: ["inspection_point_A", "log_check"], home: "dock", onFinding: "hold_and_finish", ask: (s) => `Site inspection at ${s}. Report hazards or damage in view.` },
  "aerial.inspection": { candidates: ["inspection_point_A"], home: "dock", onFinding: "hold_and_finish", ask: (s) => `Inspection at ${s}. Report hazards or damage in view.` },
  "warehouse.patrol": { candidates: ["inspection_point_A", "destination"], home: "dock", onFinding: "report_and_continue", ask: (s) => `Patrol stop ${s}. Report anything blocking aisles or out of place.` },
  "outdoor.patrol": {
    candidates: ["creek_crossing", "log_check", "fire_lookout"],
    home: "dock",
    onFinding: "report_and_continue",
    ask: (s) => `Trail patrol at ${s.replace("_", " ")}. Report hazards: fallen trees across the path, fire, smoke, flooding.`,
  },
  "indoor.delivery": { candidates: ["destination", "kitchen"], home: "dock", onFinding: "report_and_continue", ask: (s) => `Delivery drop at ${s}. Is the drop spot clear?` },
};

const CONFIDENCE_FLOOR = 0.6;
const ACTIONS = new Set(["continue_mission", "pause_and_request_inspection", "return_to_dock", "abort_mission"]);
const CLEANING_PASS_S = 8;
const micro = (a: string) => {
  const [i, f = ""] = a.split(".");
  return BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};
const fromMicro = (v: bigint) => `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`.replace(/0{1,4}$/, "");

export type Wallet = {
  pay(p: { to: string; wei: bigint; kind: "job" | "payout" | "refund"; id: string }): Promise<{ txHash: `0x${string}`; status: "success" | "reverted" | "pending" }>;
  checkIncoming(w: { hash: `0x${string}`; from: string; minWei: bigint; kind: "quote"; id: string }): Promise<TransferCheck>;
};

export type Deps = {
  robotId: string;
  robotWallet: string;
  wallet: Wallet;
  /** Resolves with the next payment transaction hash the customer reports for this task, or null at the deadline. */
  awaitPayment: (taskId: string, waitMs: number) => Promise<string | null>;
  quoteValidMs?: number;
  paymentPollMs?: number;
  local: LocalApi;
  platform: PlatformApi;
  evidence: EvidenceSink;
  store: TaskStore;
  progress: Progress;
  ack: (taskId: string, accepted: boolean, reason?: string) => void;
  inferenceTimeoutMs?: number;
  missionTimeoutMs?: number;
};

export async function runTask(a: Assignment, d: Deps): Promise<EpisodeRecord | null> {
  const { store, local, platform } = d;
  if (!store.begin(a.taskId, a)) return null; // re-delivered: never run twice
  const episodeId = `ep-${randomUUID().slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const decisions: Decision[] = [];
  const access: AccessRecord[] = [];
  const purchases: Purchase[] = [];
  const actions: EpisodeRecord["actions"] = [];
  const mission: unknown[] = [];
  let hired: SpecialistOffer[] = [];
  let quoteDoc: EpisodeRecord["quote"];
  let world: string | null = null;
  let stops: string[] = [];
  let ownerWallet: string | null = null;
  let paid: { from: string; wei: bigint; txHash: string } | null = null;
  let budget: bigint | null = null; // micro-0G the robot may spend on agents
  let spent = 0n; // micro-0G actually paid to agents
  const money: EpisodeRecord["money"] = { token: "0G", funding: "none", budget0G: null, agentsPaid0G: "0" };
  const now = () => new Date().toISOString();
  const touch = (what: string, source: string, detail: string, leftRobot = false) => access.push({ at: now(), what, source, detail, leftRobot });
  const move = (s: TaskState, why: string) => {
    store.move(a.taskId, s, why);
    d.progress(s, a.taskId, why);
  };
  const finish = async (outcome: EpisodeRecord["outcome"], why: string): Promise<EpisodeRecord> => {
    move(outcome === "COMPLETED" ? "COMPLETED" : outcome === "SAFE_STOP" ? "SAFE_STOP" : outcome === "ABORTED" ? "ABORTED" : "FAILED", why);
    // settle a customer's payment: the margin to the owner if the job is done, otherwise the rest back
    if (paid) {
      const left = weiToMicro(paid.wei) - spent;
      if (left > 0n) {
        const done = outcome === "COMPLETED";
        const to = done ? ownerWallet : paid.from;
        const t: Transfer = { to: to ?? "", amount0G: fromMicro(left), status: "not sent" };
        if (to) {
          const r = await d.wallet.pay({ to, wei: toWei(fromMicro(left)), kind: done ? "payout" : "refund", id: a.taskId }).catch((e) => ({ error: (e as Error).message }));
          if ("error" in r) t.status = `failed: ${r.error}; the 0G stays in the robot wallet`;
          else Object.assign(t, { txHash: r.txHash, status: r.status });
        }
        if (done) money.payout = t;
        else money.refund = t;
        move(outcome === "COMPLETED" ? "COMPLETED" : outcome === "SAFE_STOP" ? "SAFE_STOP" : outcome === "ABORTED" ? "ABORTED" : "FAILED", `${done ? "paid the owner" : "refunded the customer"} ${t.amount0G} 0G (${t.status})`);
      }
    }
    money.agentsPaid0G = fromMicro(spent);
    const ep: EpisodeRecord = {
      episodeId, taskId: a.taskId, robotId: d.robotId, world, skill: a.skill, outcome, startedAt, endedAt: now(), stops,
      quote: quoteDoc, money,
      hired: hired.map((h) => h.agentId), decisions, access, purchases, actions, transitions: store.history(a.taskId), mission,
    };
    await d.evidence.episode(ep).catch(() => undefined); // evidence retries on its own; never blocks safety
    return ep;
  };
  const decline = async (why: string) => {
    d.ack(a.taskId, false, why);
    store.move(a.taskId, "ABORTED", why);
    return null;
  };
  const drive = async (waypoints: string[], capture: boolean, dwell = 0) => {
    const go = await local.startMission({ taskId: a.taskId, episodeId, waypoints, captureKeyframe: capture, ...(dwell ? { dwellS: dwell } : {}) });
    if (!go.accepted) return { ok: false as const, why: `mission rejected: ${go.message}`, safety: false };
    const res = await local.waitMission(d.missionTimeoutMs ?? 300_000);
    mission.push(res);
    if (!res) {
      await local.cancel();
      return { ok: false as const, why: "mission timed out", safety: false };
    }
    if (!res.success) return { ok: false as const, why: `mission ${res.outcome}: ${res.message}`, safety: res.outcome === "ABORTED_SAFETY" };
    return { ok: true as const, res };
  };

  // ---- validate
  move("VALIDATING", "checking safety, skill, deadline");
  const st = await local.state().catch(() => null);
  touch("robot state", "ROS gateway (local)", st ? `safety ${st.safetyState}, battery ${Math.round(st.batteryPct)}%, zone ${st.zone}` : "unreachable");
  if (!st || st.safetyState !== "NORMAL" || !st.executor) return decline(`robot not ready (${st ? `${st.safetyState}${st.executor ? "" : ", no executor"}` : "ROS gateway unreachable"})`);
  world = st.world ?? null;
  const profile = await platform.robot(d.robotId).catch(() => null);
  touch("own robot profile", "Arkiv registry", profile ? `pricing ${profile.pricing?.minFee}-${profile.pricing?.maxQuote} ${profile.pricing?.token}, ${profile.capabilities.length} skills` : "not found");
  if (!profile?.pricing) return decline("robot profile with a pricing policy not found on Arkiv");
  if (profile.pricing.token !== "0G") return decline("this robot's pricing is not in 0G; re-register it to take paid tasks");
  ownerWallet = profile.ownerWallet;
  if (!profile.capabilities.includes(a.skill as never)) return decline(`this robot does not offer ${a.skill}`);
  const sp = SKILL_PLANS[a.skill];
  if (!sp) return decline(`no plan for ${a.skill}`);
  if (a.deadline && Date.parse(a.deadline) <= Date.now()) return decline("deadline passed");

  // ---- plan the stops from this world's waypoints
  const here = new Set(st.waypoints ?? []);
  stops = sp.candidates.filter((c) => here.has(c)).slice(0, Math.max(1, a.plan.waypoints));
  if (!stops.length) return decline(`this world (${world ?? "unknown"}) has none of the stops ${a.skill} needs`);
  move("PLANNING", `${stops.length} stop(s) in ${world ?? "this world"}: ${stops.join(", ")}`);

  // ---- quote with live prices
  const [listed, catalog] = await Promise.all([platform.agents().catch(() => [] as AgentListing[]), platform.catalog().catch(() => ({ models: [] }))]);
  // the robot can only pay agents priced in 0G
  const agents = listed.filter((x) => x.price.token === "0G");
  touch("agent listings", "Arkiv registry", `${listed.length} specialist agents read, ${agents.length} priced in 0G`);
  touch("model prices", "0G Router catalog", `${catalog.models.length} models`);
  const offers: SpecialistOffer[] = agents.map((x) => ({ agentId: x.agentId, name: x.displayName, kind: x.kind, price: x.price.amount, trustMode: x.inference?.trustMode ?? "none" }));
  const visionModel = agents.find((x) => x.kind === "vision" && x.inference)?.inference?.model;
  const m = catalog.models.find((x) => x.id === visionModel);
  const q = quoteTask({
    robotType: profile.robotType,
    policy: { minFee: profile.pricing.minFee, maxQuote: profile.pricing.maxQuote, marginPct: profile.pricing.marginPct, maxSpendPerTask: profile.pricing.maxSpendPerTask },
    plan: { skill: a.skill, waypoints: stops.length, distanceM: a.plan.distanceM, checkpoints: stops.length, privacy: a.plan.privacy as "private" },
    offers,
    inference: m ? { model: m.id, promptNeuron: m.promptNeuron, completionNeuron: m.completionNeuron } : null,
  });
  if (q.status !== "ok") return decline(q.reason);
  if (a.maxBudget && micro(q.quote) > micro(a.maxBudget)) return decline(`quote ${q.quote} 0G is over the customer's budget of ${a.maxBudget}`);
  const quoteId = `quote-${randomUUID().slice(0, 18)}`;
  const validMs = d.quoteValidMs ?? 5 * 60_000;
  quoteDoc = { quoteId, amount: q.quote, cost: q.cost, lines: q.lines.map((l) => ({ label: l.label.slice(0, 60), amount: l.amount, source: l.source })) };
  await d.evidence
    .quote({ schemaVersion: "1.0", quoteId, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, amount: q.quote, cost: q.cost, lines: quoteDoc.lines, validUntil: new Date(Date.now() + validMs).toISOString() })
    .catch(() => undefined);
  d.ack(a.taskId, true);

  // ---- payment: the customer pays the quote to this robot's wallet; the robot checks it on chain
  const cap = micro(profile.pricing.maxSpendPerTask);
  if (a.customerWallet) {
    move("AWAITING_PAYMENT", `pay ${q.quote} 0G to ${d.robotWallet} with memo semmal:quote:${quoteId} within ${Math.round(validMs / 60_000)} min`);
    const until = Date.now() + validMs;
    while (!paid && Date.now() < until) {
      const tx = await d.awaitPayment(a.taskId, until - Date.now());
      if (!tx) break;
      for (let i = 0; i < 30 && !paid && Date.now() < until; i++) {
        const c = await d.wallet
          .checkIncoming({ hash: tx as `0x${string}`, from: a.customerWallet, minWei: toWei(q.quote), kind: "quote", id: quoteId })
          .catch((e) => ({ ok: false as const, reason: `could not check: ${(e as Error).message}` }));
        if (c.ok) paid = { from: c.from, wei: c.valueWei, txHash: tx };
        else if (/not mined|not found|not confirmed|could not check/.test(c.reason)) await new Promise((r) => setTimeout(r, d.paymentPollMs ?? 3000));
        else {
          move("AWAITING_PAYMENT", `payment ${tx.slice(0, 10)}… not accepted: ${c.reason}`);
          break;
        }
      }
    }
    if (!paid) {
      store.move(a.taskId, "ABORTED", "the quote was not paid before it expired");
      d.progress("ABORTED", a.taskId, "the quote was not paid before it expired; nothing was done");
      return null;
    }
    money.funding = "customer payment";
    money.customerPayment = { from: paid.from, amount0G: fromMicro(weiToMicro(paid.wei)), txHash: paid.txHash };
    touch("customer payment", "0G Galileo", `${money.customerPayment.amount0G} 0G from ${paid.from}, tx ${paid.txHash}`);
    budget = weiToMicro(paid.wei) < cap ? weiToMicro(paid.wei) : cap;
    move("PAID", `received ${money.customerPayment.amount0G} 0G; agent budget ${fromMicro(budget)} 0G`);
  } else {
    money.funding = "robot's own balance (owner test task)";
    budget = cap;
  }
  money.budget0G = fromMicro(budget);

  // ---- hire (the robot chooses)
  move("DISCOVERING_SPECIALISTS", `${offers.length} agents on Arkiv`);
  hired = q.hired;
  const vision = hired.find((h) => h.kind === "vision");
  if (!vision) return finish("FAILED", "no vision agent hired");
  const navigator = hired.find((h) => h.kind === "navigation");
  move("HIRING_SPECIALISTS", hired.map((h) => `${h.name} ${h.price}`).join(", "));
  const jobDeadline = new Date(Date.now() + (d.missionTimeoutMs ?? 300_000) * (stops.length + 1)).toISOString();
  for (const h of hired) {
    await d.evidence.claim({ schemaVersion: "1.0", jobId: `job-${randomUUID().slice(0, 16)}`, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, agentId: h.agentId, price: h.price, deadline: jobDeadline }).catch(() => undefined);
  }

  /**
   * One agent job: pay the agent's owner (the wallet on its Arkiv listing) in 0G first, then send the
   * job with the payment's hash. Recorded as a purchase whatever happens. `blocked` means no money moved.
   */
  const job = async (agent: AgentListing, forWhat: string, input: unknown) => {
    const jobId = `job-${randomUUID().slice(0, 16)}`;
    const price = micro(agent.price.amount);
    const rec: Purchase = {
      at: now(), agentId: agent.agentId, agentName: agent.displayName, kind: agent.kind, forWhat, price0G: agent.price.amount, payTo: agent.ownerWallet,
      paymentStatus: "not paid", status: "not run", model: agent.inference?.model, trustMode: agent.inference?.trustMode,
    };
    purchases.push(rec);
    if (budget === null || spent + price > budget) {
      rec.status = "not bought: over the task's agent budget";
      return { r: null, latencyMs: 0, blocked: `paying ${agent.displayName} ${agent.price.amount} 0G would exceed the agent budget of ${fromMicro(budget ?? 0n)} 0G` };
    }
    const pay = await d.wallet.pay({ to: agent.ownerWallet, wei: toWei(agent.price.amount), kind: "job", id: jobId }).catch((e) => ({ error: (e as Error).message }));
    if ("error" in pay || pay.status !== "success") {
      rec.paymentStatus = "error" in pay ? `failed: ${pay.error}` : pay.status;
      if (!("error" in pay)) rec.paymentTx = pay.txHash;
      if (!("error" in pay) && pay.status === "pending") spent += price; // may still land: count it, never pay it again
      rec.status = "not run: payment did not go through";
      return { r: null, latencyMs: 0, blocked: `could not pay ${agent.displayName}: ${rec.paymentStatus}` };
    }
    spent += price;
    Object.assign(rec, { paymentTx: pay.txHash, paymentStatus: "paid" });
    const t0 = Date.now();
    let r;
    try {
      r = await Promise.race([
        platform.runJob(agent.agentId, {
          jobId, parentTaskId: a.taskId, requestingRobotId: d.robotId, targetAgentId: agent.agentId, capabilityId: agent.capabilities[0]!.capabilityId,
          input, budgetLimit: agent.price.amount, deadline: new Date(Date.now() + (d.inferenceTimeoutMs ?? 45_000)).toISOString(), idempotencyKey: jobId,
          payment: { txHash: pay.txHash },
        }),
        new Promise<null>((ok) => setTimeout(() => ok(null), d.inferenceTimeoutMs ?? 45_000)),
      ]);
    } catch {
      r = undefined;
    }
    Object.assign(rec, {
      status: r?.status === "succeeded" ? "delivered" : r ? `not delivered (${r.status}${r.reason ? `: ${r.reason.slice(0, 80)}` : ""})` : "no answer",
      providerRequestId: r?.receipt?.providerRequestId,
      billing: r?.receipt?.billing,
    });
    return { r: r ?? null, latencyMs: r?.receipt?.latencyMs ?? Date.now() - t0, blocked: undefined as string | undefined };
  };

  // ---- optional: a navigation agent orders the stops (the robot keeps its own order otherwise)
  if (navigator && stops.length > 1) {
    const nav = agents.find((x) => x.agentId === navigator.agentId)!;
    touch("stop list", "robot-master", `${stops.length} stop names sent to ${nav.displayName}`, true);
    const { r } = await job(nav, `order ${stops.length} stops`, { stops, constraints: `start and end at ${sp.home}` });
    const out = r?.status === "succeeded" ? NavigationPlanOutput.safeParse(r.output) : null;
    const proposed = out?.success ? out.data.order : null;
    if (proposed && proposed.length === stops.length && proposed.every((s) => stops.includes(s)) && new Set(proposed).size === stops.length) {
      stops = proposed;
      move("PLANNING", `route ordered by ${nav.displayName}: ${stops.join(" → ")}`);
    } else move("PLANNING", "navigation answer not usable; keeping the robot's own order");
  }

  const visionAgent = agents.find((x) => x.agentId === vision.agentId)!;

  // ---- visit each stop: drive, look, decide, act
  for (const stop of stops) {
    move("EXECUTING", `driving to ${stop}`);
    const leg = await drive([stop], true);
    if (!leg.ok) return finish(leg.safety ? "SAFE_STOP" : "FAILED", leg.why);
    const frame = leg.res.keyframePaths.at(-1);
    if (!frame) return finish("FAILED", `no camera frame at ${stop}`);
    const img = await local.keyframe(frame);
    touch("camera frame", `robot camera at ${stop}`, `${img.width}x${img.height} frame kept on the robot; a copy went to ${visionAgent.displayName} for one check, not stored by SEMMAL`, true);

    let answer: { action: string; confidence: number; observation: string; anomaly: string | null; found: boolean } | null = null;
    for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
      const { r, latencyMs, blocked } = await job(visionAgent, `look at ${stop}`, { image: img.dataUrl, context: sp.ask(stop) });
      if (blocked) {
        await local.hold(true);
        return finish("SAFE_STOP", `${blocked}; holding at ${stop}, nothing invented`);
      }
      const base = { at: now(), checkpoint: stop, agentId: visionAgent.agentId, model: visionAgent.inference?.model ?? "", trustMode: visionAgent.inference?.trustMode ?? "", latencyMs };
      if (!r || r.status !== "succeeded") {
        decisions.push({ ...base, providerRequestId: r?.receipt?.providerRequestId, outcome: r ? "failed" : "timeout", action: "hold" });
        await local.hold(true);
        move("WAITING_FOR_0G", r ? (r.reason ?? r.status) : "no answer before the deadline");
        continue;
      }
      const out = VisionInspectionOutput.safeParse(r.output);
      const ok = out.success && ACTIONS.has(out.data.recommended_action) && out.data.confidence >= CONFIDENCE_FLOOR;
      decisions.push({
        ...base, providerRequestId: r.receipt?.providerRequestId, outcome: ok ? "accepted" : "rejected", action: ok ? out.data.recommended_action : "hold",
        observation: out.success ? out.data.observation : undefined, anomaly: out.success ? out.data.anomaly_type : undefined, confidence: out.success ? out.data.confidence : undefined,
      });
      if (ok)
        answer = { action: out.data.recommended_action, confidence: out.data.confidence, observation: out.data.observation, anomaly: out.data.anomaly_type, found: out.data.anomaly_detected };
      else {
        await local.hold(true);
        move("WAITING_FOR_0G", out.success ? `confidence ${out.data.confidence} below ${CONFIDENCE_FLOOR}` : "answer did not match the required format");
      }
    }
    if (!answer) {
      await local.hold(true); // stays held; only a new assignment or an operator moves it
      return finish("SAFE_STOP", `no valid 0G decision at ${stop} after two attempts; holding position, nothing invented`);
    }
    await local.hold(false);
    move("VERIFYING", `${stop}: ${answer.observation}${answer.found ? `, found ${answer.anomaly ?? "an issue"}` : ", nothing found"} (${answer.confidence})`);

    if (answer.action === "abort_mission") {
      actions.push({ at: now(), stop, action: "abort", why: "vision agent recommended abort" });
      if (sp.onFinding === "report_and_continue") {
        const back = await drive([sp.home], false);
        return finish(back.ok ? "ABORTED" : back.safety ? "SAFE_STOP" : "FAILED", `aborted at ${stop}; ${back.ok ? `returned to ${sp.home}` : back.why}`);
      }
      return finish("ABORTED", `aborted at ${stop}; stopped there`);
    }
    if (answer.action === "return_to_dock") {
      actions.push({ at: now(), stop, action: "return", why: "vision agent recommended returning" });
      const back = await drive([sp.home], false);
      return finish(back.ok ? "COMPLETED" : back.safety ? "SAFE_STOP" : "FAILED", back.ok ? `returned to ${sp.home} from ${stop}` : back.why);
    }
    if (answer.found || answer.action === "pause_and_request_inspection") {
      if (sp.onFinding === "hold_and_finish") {
        await local.hold(true);
        actions.push({ at: now(), stop, action: "hold for a human", why: answer.anomaly ?? "finding" });
        return finish("COMPLETED", `finding at ${stop} (${answer.anomaly ?? "issue"}); holding for a human inspection`);
      }
      if (sp.onFinding === "clean_and_continue") {
        move("EXECUTING", `cleaning stop at ${stop} (${answer.anomaly ?? "mess"})`);
        const clean = await drive([stop], false, CLEANING_PASS_S);
        if (!clean.ok) return finish(clean.safety ? "SAFE_STOP" : "FAILED", clean.why);
        actions.push({ at: now(), stop, action: `cleaning stop: held ${CLEANING_PASS_S} s on the spot (no brush or vacuum is modelled on this body)`, why: answer.anomaly ?? "mess on the floor" });
      } else actions.push({ at: now(), stop, action: "hazard reported, patrol continues", why: answer.anomaly ?? "hazard" });
    } else actions.push({ at: now(), stop, action: "nothing to do", why: answer.observation });
  }

  move("EXECUTING", `returning to ${sp.home}`);
  const back = await drive([sp.home], false);
  if (!back.ok) return finish(back.safety ? "SAFE_STOP" : "FAILED", back.why);
  return finish("COMPLETED", `visited ${stops.join(", ")}; back at ${sp.home}`);
}
