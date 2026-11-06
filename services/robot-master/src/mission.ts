/**
 * The robot master agent's decision loop for one task. The robot decides; nobody decides for it.
 *
 *  validate -> plan stops for THIS world -> quote (own policy, live prices) -> hire agents itself
 *  -> (optional) navigation agent orders the stops -> for each stop: drive, look, ask the vision agent
 *  on 0G, check the answer, act within bounds -> return -> episode evidence (signed, 0G Storage, Arkiv)
 *
 * 0G is advisory and never invented: a failed or late answer holds the robot (WAITING_FOR_0G), one
 * retry, then SAFE_STOP. Safety never waits for any of this; the ROS supervisor owns it.
 * The episode records what the robot accessed and what it bought.
 */
import { randomUUID } from "node:crypto";
import { NavigationPlanOutput, VisionInspectionOutput, type AgentListing, type JobClaim, type TaskQuote } from "@semmal/contracts";
import { quoteTask, type SpecialistOffer } from "@semmal/quote";
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
/** Something the robot paid for (or committed to pay; payments are not executed yet). */
export type Purchase = { at: string; agentId: string; agentName: string; kind: string; forWhat: string; priceUsdc: string; status: string; providerRequestId?: string; model?: string; trustMode?: string };

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
  quote?: { amount: string; cost: string; lines: { label: string; usdc: string; source: string }[] };
  spend: { quotedUsdc: string | null; agentsUsdc: string; budgetUsdc: string | null };
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

export type Deps = {
  robotId: string;
  robotWallet: string;
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
  const now = () => new Date().toISOString();
  const touch = (what: string, source: string, detail: string, leftRobot = false) => access.push({ at: now(), what, source, detail, leftRobot });
  const move = (s: TaskState, why: string) => {
    store.move(a.taskId, s, why);
    d.progress(s, a.taskId, why);
  };
  const finish = async (outcome: EpisodeRecord["outcome"], why: string): Promise<EpisodeRecord> => {
    move(outcome === "COMPLETED" ? "COMPLETED" : outcome === "SAFE_STOP" ? "SAFE_STOP" : outcome === "ABORTED" ? "ABORTED" : "FAILED", why);
    const spent = purchases.filter((p) => p.status === "delivered").reduce((s, p) => s + micro(p.priceUsdc), 0n);
    const ep: EpisodeRecord = {
      episodeId, taskId: a.taskId, robotId: d.robotId, world, skill: a.skill, outcome, startedAt, endedAt: now(), stops,
      quote: quoteDoc, spend: { quotedUsdc: quoteDoc?.amount ?? null, agentsUsdc: fromMicro(spent), budgetUsdc: a.maxBudget ?? null },
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
  touch("own robot profile", "Arkiv registry", profile ? `pricing ${profile.pricing?.minFee}-${profile.pricing?.maxQuote} USDC, ${profile.capabilities.length} skills` : "not found");
  if (!profile?.pricing) return decline("robot profile with a pricing policy not found on Arkiv");
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
  const [agents, catalog] = await Promise.all([platform.agents().catch(() => [] as AgentListing[]), platform.catalog().catch(() => ({ rate: null, models: [] }))]);
  touch("agent listings", "Arkiv registry", `${agents.length} specialist agents read`);
  touch("model prices", "0G Router catalog", `${catalog.models.length} models, rate ${catalog.rate ?? "not configured"}`);
  const offers: SpecialistOffer[] = agents.map((x) => ({ agentId: x.agentId, name: x.displayName, kind: x.kind, price: x.price.amount, trustMode: x.inference?.trustMode ?? "none" }));
  const visionModel = agents.find((x) => x.kind === "vision" && x.inference)?.inference?.model;
  const m = catalog.models.find((x) => x.id === visionModel);
  const q = quoteTask({
    robotType: profile.robotType,
    policy: { minFee: profile.pricing.minFee, maxQuote: profile.pricing.maxQuote, marginPct: profile.pricing.marginPct, maxSpendPerTask: profile.pricing.maxSpendPerTask },
    plan: { skill: a.skill, waypoints: stops.length, distanceM: a.plan.distanceM, checkpoints: stops.length, privacy: a.plan.privacy as "private" },
    offers,
    inference: m ? { model: m.id, promptNeuron: m.promptNeuron, completionNeuron: m.completionNeuron } : null,
    zerogUsdcRate: catalog.rate,
  });
  if (q.status !== "ok") return decline(q.reason);
  if (a.maxBudget && micro(q.quote) > micro(a.maxBudget)) return decline(`quote ${q.quote} USDC is over the customer's budget of ${a.maxBudget}`);
  quoteDoc = { amount: q.quote, cost: q.cost, lines: q.lines.map((l) => ({ label: l.label.slice(0, 60), usdc: l.usdc, source: l.source })) };
  await d.evidence
    .quote({ schemaVersion: "1.0", quoteId: `quote-${randomUUID().slice(0, 18)}`, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, amount: q.quote, cost: q.cost, lines: quoteDoc.lines, validUntil: new Date(Date.now() + 5 * 60_000).toISOString() })
    .catch(() => undefined);
  d.ack(a.taskId, true);

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

  /** One paid agent job; recorded as a purchase whatever happens. */
  const job = async (agent: AgentListing, forWhat: string, input: unknown) => {
    const jobId = `job-${randomUUID().slice(0, 16)}`;
    const t0 = Date.now();
    let r;
    try {
      r = await Promise.race([
        platform.runJob(agent.agentId, {
          jobId, parentTaskId: a.taskId, requestingRobotId: d.robotId, targetAgentId: agent.agentId, capabilityId: agent.capabilities[0]!.capabilityId,
          input, budgetLimit: agent.price.amount, deadline: new Date(Date.now() + (d.inferenceTimeoutMs ?? 45_000)).toISOString(), idempotencyKey: jobId,
        }),
        new Promise<null>((ok) => setTimeout(() => ok(null), d.inferenceTimeoutMs ?? 45_000)),
      ]);
    } catch {
      r = undefined;
    }
    purchases.push({
      at: now(), agentId: agent.agentId, agentName: agent.displayName, kind: agent.kind, forWhat, priceUsdc: agent.price.amount,
      status: r?.status === "succeeded" ? "delivered" : r ? `not delivered (${r.status})` : "no answer",
      providerRequestId: r?.receipt?.providerRequestId, model: agent.inference?.model, trustMode: agent.inference?.trustMode,
    });
    return { r: r ?? null, latencyMs: r?.receipt?.latencyMs ?? Date.now() - t0 };
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
      const { r, latencyMs } = await job(visionAgent, `look at ${stop}`, { image: img.dataUrl, context: sp.ask(stop) });
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
