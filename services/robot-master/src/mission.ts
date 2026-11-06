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
import { SKILL_STOPS, scoreAgentJob, scoreTask, type AgentJobScore, type TaskScore, NavigationPlanOutput, VisionInspectionOutput, type AgentListing, type JobClaim, type TaskQuote } from "@semmal/contracts";
import { quoteTask, rankSpecialists, toWei, weiToMicro, type SpecialistOffer, type TaskPlan } from "@semmal/quote";
import type { TransferCheck } from "@semmal/zerog-pay";
import type { ClearStep, LocalApi } from "./local";
import type { PlatformApi, TravelRoute } from "./platform";
import { coarse, distanceM } from "@semmal/contracts";
import type { TaskState, TaskStore } from "./store";

export type Assignment = {
  taskId: string;
  skill: string;
  plan: { waypoints: number; distanceM: number; privacy: string };
  maxBudget?: string;
  deadline?: string;
  customerWallet?: string;
  /** The customer's site (exact; never written to evidence) and when to be there. */
  site?: { lat: number; lon: number };
  startAt?: string;
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
  /** The robot's score for this agent job (agent-job-score-v1); absent when the job never ran because of the robot. */
  score?: AgentJobScore;
};
export type ExtraRequest = { extraId: string; stop: string; requestedAt: string };
export type ExtraRecord = ExtraRequest & { decidedAt: string; accepted: boolean; reason: string };
/** At most this many extra stops per job, on top of the booked ones. */
export const MAX_EXTRAS = 3;

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
  /** The trip to the customer's site. Points rounded to about 1 km: the exact address is not kept. */
  travel?: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; distanceM: number; plannedS: number; routeSource: string; departedAt: string; arrivedAt: string; startAt?: string };
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
  /** Stops the customer asked for during the job, and the robot's answer to each. */
  extras: ExtraRecord[];
  /** The robot's own score for this job (task-score-v1), computed from this record before it is signed. */
  score?: TaskScore;
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
type SkillPlan = { candidates: readonly string[]; home: string; onFinding: OnFinding; ask: (stop: string) => string };

/** Stops are chosen from the world's own waypoints (the gateway reports them), in this preference order. */
export const SKILL_PLANS: Record<string, SkillPlan> = {
  "home.cleaning": {
    candidates: SKILL_STOPS["home.cleaning"]!,
    home: "dock",
    onFinding: "clean_and_continue",
    ask: (s) => `Home cleaning check in the ${s.replace("_", " ")}. Is the floor clean? Report spills, stains or clutter on the floor.`,
  },
  "warehouse.inspection": { candidates: SKILL_STOPS["warehouse.inspection"]!, home: "dock", onFinding: "hold_and_finish", ask: (s) => `Warehouse inspection at ${s}. Check the machine panel and its vents for obstructions or damage.` },
  "site.inspection": { candidates: SKILL_STOPS["site.inspection"]!, home: "dock", onFinding: "hold_and_finish", ask: (s) => `Site inspection at ${s}. Report hazards or damage in view.` },
  "aerial.inspection": { candidates: SKILL_STOPS["aerial.inspection"]!, home: "dock", onFinding: "hold_and_finish", ask: (s) => `Inspection at ${s}. Report hazards or damage in view.` },
  "warehouse.patrol": { candidates: SKILL_STOPS["warehouse.patrol"]!, home: "dock", onFinding: "report_and_continue", ask: (s) => `Patrol stop ${s}. Report anything blocking aisles or out of place.` },
  "outdoor.patrol": {
    candidates: SKILL_STOPS["outdoor.patrol"]!,
    home: "dock",
    onFinding: "report_and_continue",
    ask: (s) => `Trail patrol at ${s.replace("_", " ")}. Report hazards: fallen trees across the path, fire, smoke, flooding.`,
  },
  "indoor.delivery": { candidates: SKILL_STOPS["indoor.delivery"]!, home: "dock", onFinding: "report_and_continue", ask: (s) => `Delivery drop at ${s}. Is the drop spot clear?` },
};

const CONFIDENCE_FLOOR = 0.6;
/** 0G Router error codes that mean "this agent cannot serve right now", not "the input was bad". */
const AGENT_CANNOT_SERVE = new Set(["no_provider_for_trust_mode", "credit_limit_exceeded"]);
const ACTIONS = new Set(["continue_mission", "clear_and_continue", "pause_and_request_inspection", "return_to_dock", "abort_mission"]);
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

/** One 0G call and what the robot did with it: everything except the image itself and the prompt bytes. */
export type DecisionDetail = {
  taskId: string; at: string; stop: string; attempt: number;
  agentId: string; agentName: string; agentPrice0G: string; paymentTx?: string;
  question: string; frame: string;
  model: string; trustMode: string;
  receipt?: Record<string, unknown>;
  output?: unknown;
  checks: { format: boolean; actionAllowed: boolean; confidence: number | null; confidenceFloor: number };
  outcome: string; action: string; reason?: string;
};

export type Deps = {
  robotId: string;
  robotWallet: string;
  wallet: Wallet;
  /** Resolves with the next payment transaction hash the customer reports for this task, or null at the deadline. */
  awaitPayment: (taskId: string, waitMs: number) => Promise<string | null>;
  quoteValidMs?: number;
  paymentPollMs?: number;
  /** The robot's exact base (from its setup); the trip starts here. */
  base?: { lat: number; lon: number };
  /** Live position while travelling, to the platform only. */
  position?: (p: { taskId: string; lat: number; lon: number; phase: "WAITING" | "TRAVELLING" | "ARRIVED"; etaAt?: string; remainingM?: number }) => void;
  /** Development: true once someone asked to fast-forward this task's trip. */
  fastForward?: (taskId: string) => boolean;
  /** Development only: travel this many times faster than the route's driving time. */
  travelSpeedup?: number;
  travelTickMs?: number;
  /** Send the offer straight to the platform (the customer can pay before Arkiv has indexed it). */
  offer?: (o: { taskId: string; quoteId: string; amount: string; validUntil: string; payTo: string }) => void;
  /** The robot owner's answer to a booking (approve before the robot moves). null = no answer in time. */
  awaitOwner?: (taskId: string, waitMs: number) => Promise<{ approved: boolean; reason?: string } | null>;
  /** The customer confirming the robot is on site. false = not confirmed in time. */
  awaitArrival?: (taskId: string, waitMs: number) => Promise<boolean>;
  ownerWaitMs?: number;
  confirmWaitMs?: number;
  /** Extra stops the customer asked for since the last call (drained: each request is returned once). */
  extras?: (taskId: string) => ExtraRequest[];
  /** The robot's answer to each extra request, sent to the platform for the customer. */
  extraResult?: (taskId: string, r: ExtraRecord) => void;
  /** Every 0G decision, in full, as it happens (for the customer's "how it decided" view). */
  decision?: (d: DecisionDetail) => void;
  log?: (m: string) => void;
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
  if (!store.begin(a.taskId, a)) {
    // re-delivered: never run twice, but say so
    const last = store.history(a.taskId).at(-1);
    d.ack(a.taskId, false, `this robot already has this task${last ? ` (${last.state}: ${last.reason.slice(0, 80)})` : ""}`);
    return null;
  }
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
  const extras: ExtraRecord[] = [];
  let findings = 0;
  let findingsHandled = 0;
  // set once the stop loop runs: decides each extra request the customer sent (see below)
  let takeExtras: (finished: boolean) => void = (finished) => {
    for (const x of d.extras?.(a.taskId) ?? []) {
      const r: ExtraRecord = { ...x, decidedAt: now(), accepted: false, reason: "the job ended before it reached its stops" };
      extras.push(r);
      d.extraResult?.(a.taskId, r);
    }
  };
  let travel: EpisodeRecord["travel"];
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
    takeExtras(true); // anything still queued gets an answer
    const endedAt = now();
    const visited = new Set(actions.map((x) => x.stop));
    const accepted = extras.filter((x) => x.accepted);
    const score = scoreTask({
      outcome, planned: stops.length, visited: stops.filter((x) => visited.has(x)).length,
      decisionsAsked: decisions.length, decisionsAccepted: decisions.filter((x) => x.outcome === "accepted").length,
      findings, findingsHandled, extrasAccepted: accepted.length, extrasDone: accepted.filter((x) => visited.has(x.stop)).length,
      deadline: a.deadline ?? null, endedAt,
    });
    const ep: EpisodeRecord = {
      episodeId, taskId: a.taskId, robotId: d.robotId, world, skill: a.skill, outcome, startedAt, endedAt, stops, extras, score,
      quote: quoteDoc, money, ...(travel ? { travel } : {}),
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
  const clearing = sp.onFinding === "clean_and_continue" && local.clear ? (st.clearing ?? {}) : {};
  if (Object.keys(clearing).length) {
    // each cleaning job starts from the same house: toys back on the floor, the spill back in the kitchen
    const r = await local.clear!("", "reset").catch((e) => ({ ok: false, moved: [] as string[], failed: [] as string[], error: (e as Error).message }));
    touch("house props", "ROS gateway (local)", r.ok ? `placed for this job: ${r.moved.join(", ")}` : `could not place: ${r.error ?? r.failed.join(", ")}`);
  }
  if (!stops.length) return decline(`this world (${world ?? "unknown"}) has none of the stops ${a.skill} needs`);
  move("PLANNING", `${stops.length} stop(s) in ${world ?? "this world"}: ${stops.join(", ")}`);

  // ---- quote with live prices
  const [listed, catalog] = await Promise.all([platform.agents().catch(() => [] as (AgentListing & { selection?: number | null })[]), platform.catalog().catch(() => ({ models: [] }))]);
  // the robot can only pay agents priced in 0G, and only use agents whose model can serve their trust mode:
  // 0G sends private requests to TEE providers only (catalog verifiability "TeeML"); when the catalog lists
  // trust levels, a model without one would fail with 503 no_provider_for_trust_mode
  const listsTrust = catalog.models.some((m) => m.verifiability);
  const servable = (x: AgentListing) => {
    if (!listsTrust || !x.inference || x.inference.trustMode === "standard") return true;
    const m = catalog.models.find((c) => c.id === x.inference!.model);
    return x.inference.trustMode === "private" ? m?.verifiability === "TeeML" : Boolean(m?.verifiability);
  };
  const agents = listed.filter((x) => x.price.token === "0G" && servable(x));
  touch("agent listings", "Arkiv registry", `${listed.length} specialist agents read, ${agents.length} priced in 0G with a model that can serve their trust mode`);
  touch("model prices", "0G Router catalog", `${catalog.models.length} models`);
  // each offer carries the agent's selection score: hiring takes the best score first (rankSpecialists)
  const offers: SpecialistOffer[] = agents.map((x) => ({ agentId: x.agentId, name: x.displayName, kind: x.kind, price: x.price.amount, trustMode: x.inference?.trustMode ?? "none", selection: x.selection }));
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
  // payment comes after arrival, so the offer holds until the booking's deadline; paying has its own window
  const validMs = d.quoteValidMs ?? 15 * 60_000;
  quoteDoc = { quoteId, amount: q.quote, cost: q.cost, lines: q.lines.map((l) => ({ label: l.label.slice(0, 60), amount: l.amount, source: l.source })) };
  const validUntil = a.deadline && Date.parse(a.deadline) > Date.now() + validMs ? new Date(a.deadline).toISOString() : new Date(Date.now() + 2 * 3600_000).toISOString();
  // the offer goes to the customer now; its Arkiv record is written in the background (evidence never blocks the job)
  d.offer?.({ taskId: a.taskId, quoteId, amount: q.quote, validUntil, payTo: d.robotWallet });
  void d.evidence
    .quote({ schemaVersion: "1.0", quoteId, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, amount: q.quote, cost: q.cost, lines: quoteDoc.lines, validUntil })
    .catch((e) => d.log?.(`offer ${quoteId} not written to Arkiv: ${(e as Error).message}`));
  d.ack(a.taskId, true);

  // ---- the robot's owner approves the booking before the robot moves
  if (a.customerWallet) {
    move("AWAITING_OWNER", `offer ${q.quote} 0G; waiting for the robot's owner to approve`);
    const decision = d.awaitOwner ? await d.awaitOwner(a.taskId, d.ownerWaitMs ?? 30 * 60_000) : { approved: true };
    if (!decision || !decision.approved) {
      const why = !decision ? "the owner did not answer in time" : `the owner declined${decision.reason ? `: ${decision.reason}` : ""}`;
      store.move(a.taskId, "ABORTED", why);
      d.progress("ABORTED", a.taskId, `${why}; nothing was done or charged`);
      return null;
    }
    move("APPROVED", "the owner approved the booking");
  }

  // ---- travel to the customer's site, timed to arrive at the booked time
  if (a.site) {
    if (!d.base) return finish("FAILED", "this robot has no base location set (pnpm run setup); it cannot plan the trip");
    const route: TravelRoute = await platform.route(d.base, a.site).catch(() => straight(d.base!, a.site!));
    const speedup = Math.max(1, d.travelSpeedup ?? 1);
    const travelMs = (route.durationS * 1000) / speedup;
    const startAtMs = a.startAt ? Date.parse(a.startAt) : Date.now();
    const departMs = Math.max(Date.now(), startAtMs - travelMs);
    touch("customer site", "booking (platform)", `about ${coarse(a.site.lat)}, ${coarse(a.site.lon)}; exact address used for the trip only, not kept here`);
    touch("route", route.source === "osrm" ? "OSRM driving route" : "straight line (routing unavailable)", `${(route.distanceM / 1000).toFixed(1)} km, ${Math.round(route.durationS / 60)} min driving`);
    if (departMs > Date.now()) {
      move("APPROVED", `leaving at ${new Date(departMs).toISOString().slice(11, 16)} to arrive by ${new Date(startAtMs).toISOString().slice(11, 16)}`);
      // wait at the base, telling the platform where it is; a fast-forward ends the wait
      while (Date.now() < departMs && !d.fastForward?.(a.taskId)) {
        d.position?.({ taskId: a.taskId, lat: d.base.lat, lon: d.base.lon, phase: "WAITING", etaAt: new Date(startAtMs).toISOString(), remainingM: route.distanceM });
        await sleep(Math.min(d.travelTickMs ?? 2000, departMs - Date.now()));
      }
    }
    const departedAt = now();
    move("TRAVELLING", `${(route.distanceM / 1000).toFixed(1)} km to the site, about ${Math.round(travelMs / 60_000)} min`);
    const cum = [0];
    for (let i = 1; i < route.coords.length; i++) cum.push(cum[i - 1]! + distanceM(pt(route.coords[i - 1]!), pt(route.coords[i]!)));
    const total = cum.at(-1) || 1;
    // drive along the route; a fast-forward finishes the rest in about 8 seconds
    let speed = total / Math.max(0.001, travelMs / 1000); // metres per second
    let done = 0;
    let last = Date.now();
    let fast = false;
    for (;;) {
      const t = Date.now();
      if (!fast && d.fastForward?.(a.taskId)) {
        fast = true;
        speed = Math.max(speed, (total - done) / 8);
        move("TRAVELLING", "fast-forwarding the trip");
      }
      done = Math.min(total, done + (speed * (t - last)) / 1000);
      last = t;
      if (done >= total) break;
      const p = along(route.coords, cum, done);
      d.position?.({ taskId: a.taskId, lat: p.lat, lon: p.lon, phase: "TRAVELLING", etaAt: new Date(t + ((total - done) / speed) * 1000).toISOString(), remainingM: Math.round(total - done) });
      await sleep(d.travelTickMs ?? 2000);
    }
    d.position?.({ taskId: a.taskId, lat: a.site.lat, lon: a.site.lon, phase: "ARRIVED", remainingM: 0 });
    travel = {
      from: { lat: coarse(d.base.lat), lon: coarse(d.base.lon) }, to: { lat: coarse(a.site.lat), lon: coarse(a.site.lon) },
      distanceM: route.distanceM, plannedS: route.durationS, routeSource: route.source, departedAt, arrivedAt: now(), ...(a.startAt ? { startAt: a.startAt } : {}),
    };
    move("ARRIVED", "on site");
  }

  // ---- the customer confirms the robot is there: only then is the booking fully started
  if (a.customerWallet && a.site) {
    move("AWAITING_CONFIRMATION", "at the site; waiting for the customer to confirm it has arrived");
    const ok = d.awaitArrival ? await d.awaitArrival(a.taskId, d.confirmWaitMs ?? 30 * 60_000) : true;
    if (!ok) return finish("ABORTED", "the customer did not confirm the arrival in time; nothing was charged");
    move("CONFIRMED", "the customer confirmed the robot is on site");
  }

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
      // after a trip the robot keeps a record of it; before one, nothing happened
      if (travel) return finish("ABORTED", "the offer was not paid in time after arrival; nothing was charged");
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
    // job claims are evidence: written in the background, never holding up the job
    void d.evidence
      .claim({ schemaVersion: "1.0", jobId: `job-${randomUUID().slice(0, 16)}`, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, agentId: h.agentId, price: h.price, deadline: jobDeadline })
      .catch((e) => d.log?.(`job claim for ${h.agentId} not written to Arkiv: ${(e as Error).message}`));
  }

  /**
   * One agent job: pay the agent's owner (the wallet on its Arkiv listing) in 0G first, then send the
   * job with the payment's hash. Recorded as a purchase whatever happens. `blocked` means no money moved.
   */
  const job = async (agent: AgentListing, forWhat: string, input: unknown, reuse?: { jobId: string; paymentTx: string }) => {
    const jobId = reuse?.jobId ?? `job-${randomUUID().slice(0, 16)}`;
    const price = micro(agent.price.amount);
    const rec: Purchase = {
      at: now(), agentId: agent.agentId, agentName: agent.displayName, kind: agent.kind, forWhat, price0G: agent.price.amount, payTo: agent.ownerWallet,
      paymentStatus: "not paid", status: "not run", model: agent.inference?.model, trustMode: agent.inference?.trustMode,
    };
    purchases.push(rec);
    if (!reuse && (budget === null || spent + price > budget)) {
      rec.status = "not bought: over the task's agent budget";
      return { r: null, latencyMs: 0, blocked: `paying ${agent.displayName} ${agent.price.amount} 0G would exceed the agent budget of ${fromMicro(budget ?? 0n)} 0G` };
    }
    // a retry of a job whose payment could not be checked resends the same paid job: never pay twice
    const pay = reuse
      ? { txHash: reuse.paymentTx as `0x${string}`, status: "success" as const }
      : await d.wallet.pay({ to: agent.ownerWallet, wei: toWei(agent.price.amount), kind: "job", id: jobId }).catch((e) => ({ error: (e as Error).message }));
    if ("error" in pay || pay.status !== "success") {
      rec.paymentStatus = "error" in pay ? `failed: ${pay.error}` : pay.status;
      if (!("error" in pay)) rec.paymentTx = pay.txHash;
      if (!("error" in pay) && pay.status === "pending") spent += price; // may still land: count it, never pay it again
      rec.status = "not run: payment did not go through";
      return { r: null, latencyMs: 0, blocked: `could not pay ${agent.displayName}: ${rec.paymentStatus}` };
    }
    if (!reuse) spent += price;
    Object.assign(rec, { paymentTx: pay.txHash, paymentStatus: reuse ? "paid (same payment, resent)" : "paid" });
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
    return { r: r ?? null, latencyMs: r?.receipt?.latencyMs ?? Date.now() - t0, blocked: undefined as string | undefined, rec, jobId, paymentTx: pay.txHash as string };
  };

  /** Score an agent job the robot paid for. A job the runner rejected (input or payment check) is not the agent's fault. */
  const judge = (rec: Purchase | undefined, r: { status: string } | null, latencyMs: number, passedChecks: boolean) => {
    if (!rec || r?.status === "rejected") return;
    rec.score = scoreAgentJob({ delivered: r?.status === "succeeded", passedChecks, latencyMs, deadlineMs: d.inferenceTimeoutMs ?? 45_000 });
  };

  // ---- optional: a navigation agent orders the stops (the robot keeps its own order otherwise)
  if (navigator && stops.length > 1) {
    const nav = agents.find((x) => x.agentId === navigator.agentId)!;
    touch("stop list", "robot-master", `${stops.length} stop names sent to ${nav.displayName}`, true);
    const { r, rec, latencyMs } = await job(nav, `order ${stops.length} stops`, { stops, constraints: `start and end at ${sp.home}` });
    const out = r?.status === "succeeded" ? NavigationPlanOutput.safeParse(r.output) : null;
    const proposed = out?.success ? out.data.order : null;
    const usable = Boolean(proposed && proposed.length === stops.length && proposed.every((s) => stops.includes(s)) && new Set(proposed).size === stops.length);
    judge(rec, r, latencyMs, usable);
    if (proposed && usable) {
      stops = proposed;
      move("PLANNING", `route ordered by ${nav.displayName}: ${stops.join(" → ")}`);
    } else move("PLANNING", "navigation answer not usable; keeping the robot's own order");
  }

  // Alternatives in hiring order (same rule as the quote). If the hired agent cannot serve, i.e. 0G has no
  // provider for its model in its trust mode, or its daily 0G cap is used up, the robot hires the next one.
  // Never a weaker trust mode than the task needs, and job() still refuses anything over the agent budget.
  const visionChoices = rankSpecialists({ privacy: a.plan.privacy as TaskPlan["privacy"] }, offers, "vision")
    .map((o) => agents.find((x) => x.agentId === o.agentId))
    .filter((x): x is AgentListing => Boolean(x));
  let visionAgent = agents.find((x) => x.agentId === vision.agentId)!;
  const unusable = new Set<string>();

  // ---- extra stops the customer asks for during the job: the robot decides each one itself
  takeExtras = (finished) => {
    for (const x of d.extras?.(a.taskId) ?? []) {
      const price = micro(visionAgent.price.amount);
      const unchecked = stops.length - Math.min(stops.length, si); // stops still to be looked at, each one paid vision job
      const left = budget === null ? 0n : budget - spent;
      let accepted = false;
      let reason: string;
      if (finished) reason = "the job had finished its stops";
      else if (!here.has(x.stop) || !sp.candidates.includes(x.stop)) reason = `${x.stop.replace(/_/g, " ")} is not a place this robot covers for this kind of job here`;
      else if (stops.includes(x.stop)) reason = `${x.stop.replace(/_/g, " ")} is already on this job`;
      else if (extras.filter((e) => e.accepted).length >= MAX_EXTRAS) reason = `at most ${MAX_EXTRAS} extra stops per job`;
      else if (left < price * BigInt(unchecked + 1))
        reason = `the paid budget left (${fromMicro(left < 0n ? 0n : left)} 0G) does not cover ${unchecked} planned check(s) plus this one at ${visionAgent.price.amount} 0G each`;
      else {
        accepted = true;
        stops.push(x.stop);
        reason = `added as stop ${stops.length}; paid from the job's agent budget (${fromMicro(left)} 0G left)`;
      }
      const r: ExtraRecord = { ...x, decidedAt: now(), accepted, reason };
      extras.push(r);
      d.extraResult?.(a.taskId, r);
      move("PLANNING", `customer asked for ${x.stop.replace(/_/g, " ")}: ${accepted ? "accepted" : "declined"} (${reason})`);
    }
  };
  let si = 0;
  takeExtras(false);

  // ---- visit each stop: drive, look, decide, act (stops can grow with accepted extras)
  for (; si < stops.length; si++, takeExtras(false)) {
    const stop = stops[si]!;
    move("EXECUTING", `driving to ${stop}`);
    const leg = await drive([stop], true);
    if (!leg.ok) return finish(leg.safety ? "SAFE_STOP" : "FAILED", leg.why);
    const frame = leg.res.keyframePaths.at(-1);
    if (!frame) return finish("FAILED", `no camera frame at ${stop}`);
    const img = await local.keyframe(frame);
    touch("camera frame", `robot camera at ${stop}`, `${img.width}x${img.height} frame kept on the robot; one copy went to ${visionAgent.displayName} for a single private (TEE) 0G check and is not stored anywhere`, true);

    let answer: { action: string; confidence: number; observation: string; anomaly: string | null; found: boolean } | null = null;
    let reuse: { jobId: string; paymentTx: string } | undefined;
    for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
      const question = sp.ask(stop);
      const res = await job(visionAgent, `look at ${stop}`, { image: img.dataUrl, context: question }, reuse);
      const { r, latencyMs, blocked, rec } = res;
      // the agent never checked the payment (network), so the same paid job can be resent
      reuse = r?.status === "rejected" && /payment could not be checked/i.test(r.reason ?? "") && "jobId" in res && res.paymentTx ? { jobId: res.jobId!, paymentTx: res.paymentTx } : undefined;
      const tell = (x: Pick<DecisionDetail, "outcome" | "action" | "checks"> & { output?: unknown; reason?: string }) =>
        d.decision?.({
          taskId: a.taskId, at: now(), stop, attempt, agentId: visionAgent.agentId, agentName: visionAgent.displayName, agentPrice0G: visionAgent.price.amount,
          paymentTx: rec?.paymentTx, question, frame: `${img.width}x${img.height} PNG from the robot's camera, never shown or stored`,
          model: visionAgent.inference?.model ?? "", trustMode: visionAgent.inference?.trustMode ?? "",
          receipt: r?.receipt as Record<string, unknown> | undefined, ...x,
        });
      if (blocked) {
        await local.hold(true);
        return finish("SAFE_STOP", `${blocked}; holding at ${stop}, nothing invented`);
      }
      const base = { at: now(), checkpoint: stop, agentId: visionAgent.agentId, model: visionAgent.inference?.model ?? "", trustMode: visionAgent.inference?.trustMode ?? "", latencyMs };
      if (!r || r.status !== "succeeded") {
        judge(rec, r, latencyMs, false);
        decisions.push({ ...base, providerRequestId: r?.receipt?.providerRequestId, outcome: r ? "failed" : "timeout", action: "hold" });
        tell({ outcome: r ? "failed" : "timeout", action: "hold", reason: r ? (r.reason ?? r.status) : "no answer before the deadline", checks: { format: false, actionAllowed: false, confidence: null, confidenceFloor: CONFIDENCE_FLOOR } });
        if (r?.status === "failed" && r.code && AGENT_CANNOT_SERVE.has(r.code)) {
          unusable.add(visionAgent.agentId);
          const next = visionChoices.find((x) => !unusable.has(x.agentId));
          if (next) {
            move("HIRING_SPECIALISTS", `${visionAgent.displayName} cannot serve (${r.code}); hiring ${next.displayName} ${next.price.amount} 0G instead`);
            const offer = offers.find((o) => o.agentId === next.agentId);
            if (offer) hired = [...hired, offer];
            visionAgent = next;
            reuse = undefined;
            attempt -= 1; // a different agent: this does not use up one of the stop's attempts
            continue;
          }
        }
        await local.hold(true);
        move("WAITING_FOR_0G", r ? (r.reason ?? r.status) : "no answer before the deadline");
        continue;
      }
      const out = VisionInspectionOutput.safeParse(r.output);
      const ok = out.success && ACTIONS.has(out.data.recommended_action) && out.data.confidence >= CONFIDENCE_FLOOR;
      judge(rec, r, latencyMs, ok);
      decisions.push({
        ...base, providerRequestId: r.receipt?.providerRequestId, outcome: ok ? "accepted" : "rejected", action: ok ? out.data.recommended_action : "hold",
        observation: out.success ? out.data.observation : undefined, anomaly: out.success ? out.data.anomaly_type : undefined, confidence: out.success ? out.data.confidence : undefined,
      });
      tell({
        outcome: ok ? "accepted" : "rejected", action: ok ? out.data.recommended_action : "hold", output: r.output,
        reason: ok ? undefined : out.success ? (ACTIONS.has(out.data.recommended_action) ? `confidence ${out.data.confidence} is below ${CONFIDENCE_FLOOR}` : `action ${out.data.recommended_action} is not allowed`) : "the answer did not match the required format",
        checks: { format: out.success, actionAllowed: out.success && ACTIONS.has(out.data.recommended_action), confidence: out.success ? out.data.confidence : null, confidenceFloor: CONFIDENCE_FLOOR },
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
    if (answer.found || answer.action === "pause_and_request_inspection" || answer.action === "clear_and_continue") {
      findings++;
      if (sp.onFinding === "hold_and_finish") {
        await local.hold(true);
        actions.push({ at: now(), stop, action: "hold for a human", why: answer.anomaly ?? "finding" });
        findingsHandled++;
        return finish("COMPLETED", `finding at ${stop} (${answer.anomaly ?? "issue"}); holding for a human inspection`);
      }
      if (sp.onFinding === "clean_and_continue" && clearing[stop]) {
        // the robot tidies it itself: drive to the mess, pick it up (or wipe it), put it away, carry on
        const spot = clearing[stop]!;
        const what = answer.anomaly ?? "mess";
        const step = async (name: ClearStep, at: string) => {
          const r = await local.clear!(stop, name).catch((e) => ({ ok: false, moved: [], failed: [], error: (e as Error).message }));
          touch("clearing", "ROS gateway (local)", `${name} at ${at}: ${r.ok ? `moved ${r.moved.join(", ")}` : r.error ?? `could not move ${r.failed.join(", ")}`}`, false);
          return r;
        };
        move("EXECUTING", `clearing ${what} at ${stop}`);
        const reach = await drive([spot.approach], false, spot.dropAt ? 0 : CLEANING_PASS_S);
        if (!reach.ok) return finish(reach.safety ? "SAFE_STOP" : "FAILED", reach.why);
        if (spot.dropAt) {
          const picked = await step("pick", spot.approach);
          if (!picked.ok) {
            actions.push({ at: now(), stop, action: `could not pick up ${spot.pick.join(", ")}`, why: picked.error ?? what });
          } else {
            actions.push({ at: now(), stop, action: `picked up ${picked.moved.join(", ")}`, why: what });
            move("EXECUTING", `carrying ${picked.moved.length} item(s) to the bin by ${spot.dropAt}`);
            const toBin = await drive([spot.dropAt], false);
            if (!toBin.ok) return finish(toBin.safety ? "SAFE_STOP" : "FAILED", toBin.why);
            const dropped = await step("drop", spot.dropAt);
            actions.push({ at: now(), stop, action: dropped.ok ? `put ${dropped.moved.join(", ")} in the bin` : `could not put the items in the bin`, why: dropped.ok ? "floor cleared" : dropped.error ?? "drop failed" });
            if (dropped.ok) findingsHandled++;
          }
        } else {
          const wiped = await step("wipe", spot.approach);
          if (wiped.ok) findingsHandled++;
          actions.push({ at: now(), stop, action: wiped.ok ? `wiped ${wiped.moved.join(", ")} with a ${CLEANING_PASS_S} s pass` : `wiping pass of ${CLEANING_PASS_S} s; the spill did not clear`, why: wiped.ok ? what : wiped.error ?? what });
        }
      } else if (sp.onFinding === "clean_and_continue") {
        move("EXECUTING", `cleaning stop at ${stop} (${answer.anomaly ?? "mess"})`);
        const clean = await drive([stop], false, CLEANING_PASS_S);
        if (!clean.ok) return finish(clean.safety ? "SAFE_STOP" : "FAILED", clean.why);
        actions.push({ at: now(), stop, action: `cleaning stop: held ${CLEANING_PASS_S} s on the spot (no brush or vacuum is modelled on this body)`, why: answer.anomaly ?? "mess on the floor" });
        findingsHandled++;
      } else {
        actions.push({ at: now(), stop, action: "hazard reported, patrol continues", why: answer.anomaly ?? "hazard" });
        findingsHandled++;
      }
    } else actions.push({ at: now(), stop, action: "nothing to do", why: answer.observation });
  }

  move("EXECUTING", `returning to ${sp.home}`);
  const back = await drive([sp.home], false);
  if (!back.ok) return finish(back.safety ? "SAFE_STOP" : "FAILED", back.why);
  return finish("COMPLETED", `visited ${stops.join(", ")}; back at ${sp.home}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pt = (c: [number, number]) => ({ lat: c[0], lon: c[1] });
/** The point `m` metres along a polyline with cumulative distances `cum`. */
function along(coords: [number, number][], cum: number[], m: number) {
  for (let i = 1; i < coords.length; i++) {
    if (cum[i]! >= m) {
      const seg = cum[i]! - cum[i - 1]! || 1;
      const t = (m - cum[i - 1]!) / seg;
      return { lat: coords[i - 1]![0] + (coords[i]![0] - coords[i - 1]![0]) * t, lon: coords[i - 1]![1] + (coords[i]![1] - coords[i - 1]![1]) * t };
    }
  }
  return pt(coords.at(-1)!);
}
function straight(a: { lat: number; lon: number }, b: { lat: number; lon: number }): TravelRoute {
  const dm = distanceM(a, b);
  return { source: "straight-line", distanceM: Math.round(dm), durationS: Math.round(dm / 8.33), coords: [[a.lat, a.lon], [b.lat, b.lon]] };
}
