/**
 * The robot master agent's decision loop for one task. The robot decides; nobody decides for it.
 *
 *  validate -> quote (own policy, live prices) -> hire agents itself -> drive to the checkpoint
 *  -> keyframe -> vision agent on 0G (private) -> validate the answer -> bounded ROS action
 *  -> episode evidence (signed, 0G Storage, Arkiv)
 *
 * 0G is advisory and never invented: a failed or late answer holds the robot (WAITING_FOR_0G), one
 * retry, then SAFE_STOP. Safety itself never waits for any of this; the ROS supervisor owns it.
 */
import { randomUUID } from "node:crypto";
import { VisionInspectionOutput, type AgentListing, type JobClaim, type TaskQuote } from "@semmal/contracts";
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
};

export type EpisodeRecord = {
  episodeId: string;
  taskId: string;
  robotId: string;
  outcome: "COMPLETED" | "FAILED" | "ABORTED" | "SAFE_STOP";
  startedAt: string;
  endedAt: string;
  quote?: { amount: string; cost: string; lines: { label: string; usdc: string; source: string }[] };
  hired: string[];
  decisions: Decision[];
  transitions: { at: string; state: string; reason: string; actor: string }[];
  mission: unknown[];
};

export interface EvidenceSink {
  quote(q: TaskQuote): Promise<void>;
  claim(c: JobClaim): Promise<void>;
  episode(e: EpisodeRecord): Promise<void>;
}

export type Progress = (state: TaskState, taskId: string, detail?: string) => void;

/** Which named waypoints each skill visits: the checkpoint where the robot looks, then where it goes after. */
export const ROUTES: Record<string, { checkpoint: string; after: string[] }> = {
  "warehouse.inspection": { checkpoint: "inspection_point_A", after: ["dock"] },
  "site.inspection": { checkpoint: "inspection_point_A", after: ["dock"] },
  "aerial.inspection": { checkpoint: "inspection_point_A", after: ["dock"] },
  "warehouse.patrol": { checkpoint: "inspection_point_A", after: ["destination", "dock"] },
  "outdoor.patrol": { checkpoint: "inspection_point_A", after: ["destination", "dock"] },
  "indoor.delivery": { checkpoint: "destination", after: ["dock"] },
};

const CONFIDENCE_FLOOR = 0.6;
const ACTIONS = new Set(["continue_mission", "pause_and_request_inspection", "return_to_dock", "abort_mission"]);
const micro = (a: string) => {
  const [i, f = ""] = a.split(".");
  return BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};

export type Deps = {
  robotId: string;
  robotWallet: string;
  local: LocalApi;
  platform: PlatformApi;
  evidence: EvidenceSink;
  store: TaskStore;
  progress: Progress;
  ack: (taskId: string, accepted: boolean, reason?: string) => void;
  /** ms the robot waits for one 0G answer before treating it as unreachable */
  inferenceTimeoutMs?: number;
  missionTimeoutMs?: number;
};

export async function runTask(a: Assignment, d: Deps): Promise<EpisodeRecord | null> {
  const { store, local, platform } = d;
  if (!store.begin(a.taskId, a)) return null; // re-delivered: never run twice
  const episodeId = `ep-${randomUUID().slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const decisions: Decision[] = [];
  const mission: unknown[] = [];
  let hired: SpecialistOffer[] = [];
  let quoteDoc: EpisodeRecord["quote"];
  const move = (s: TaskState, why: string) => {
    store.move(a.taskId, s, why);
    d.progress(s, a.taskId, why);
  };
  const finish = async (outcome: EpisodeRecord["outcome"], why: string): Promise<EpisodeRecord> => {
    move(outcome === "COMPLETED" ? "COMPLETED" : outcome === "SAFE_STOP" ? "SAFE_STOP" : outcome === "ABORTED" ? "ABORTED" : "FAILED", why);
    const ep: EpisodeRecord = {
      episodeId, taskId: a.taskId, robotId: d.robotId, outcome, startedAt, endedAt: new Date().toISOString(),
      quote: quoteDoc, hired: hired.map((h) => h.agentId), decisions, transitions: store.history(a.taskId), mission,
    };
    await d.evidence.episode(ep).catch(() => undefined); // evidence retries on its own; never blocks safety
    return ep;
  };
  const decline = async (why: string) => {
    d.ack(a.taskId, false, why);
    store.move(a.taskId, "ABORTED", why);
    return null;
  };

  // ---- validate
  move("VALIDATING", "checking safety, skill, deadline");
  const st = await local.state().catch(() => null);
  if (!st || st.safetyState !== "NORMAL" || !st.executor) return decline(`robot not ready (${st ? `${st.safetyState}${st.executor ? "" : ", no executor"}` : "ROS gateway unreachable"})`);
  const profile = await platform.robot(d.robotId).catch(() => null);
  if (!profile?.pricing) return decline("robot profile with a pricing policy not found on Arkiv");
  if (!profile.capabilities.includes(a.skill as never)) return decline(`this robot does not offer ${a.skill}`);
  const route = ROUTES[a.skill];
  if (!route) return decline(`no route for ${a.skill}`);
  if (a.deadline && Date.parse(a.deadline) <= Date.now()) return decline("deadline passed");

  // ---- plan + quote with live prices
  move("PLANNING", `checkpoint ${route.checkpoint}`);
  const [agents, catalog] = await Promise.all([platform.agents().catch(() => [] as AgentListing[]), platform.catalog().catch(() => ({ rate: null, models: [] }))]);
  const offers: SpecialistOffer[] = agents.map((x) => ({ agentId: x.agentId, name: x.displayName, kind: x.kind, price: x.price.amount, trustMode: x.inference?.trustMode ?? "none" }));
  const looks = ["vision"]; // the checkpoint needs a vision agent's model price for the inference line
  const visionModel = agents.find((x) => looks.includes(x.kind) && x.inference)?.inference?.model;
  const m = catalog.models.find((x) => x.id === visionModel);
  const q = quoteTask({
    robotType: profile.robotType,
    policy: { minFee: profile.pricing.minFee, maxQuote: profile.pricing.maxQuote, marginPct: profile.pricing.marginPct, maxSpendPerTask: profile.pricing.maxSpendPerTask },
    plan: { skill: a.skill, waypoints: a.plan.waypoints, distanceM: a.plan.distanceM, checkpoints: 1, privacy: a.plan.privacy as "private" },
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
  move("HIRING_SPECIALISTS", hired.map((h) => `${h.name} ${h.price}`).join(", "));
  const jobDeadline = new Date(Date.now() + (d.missionTimeoutMs ?? 300_000) + 120_000).toISOString();
  for (const h of hired) {
    await d.evidence.claim({ schemaVersion: "1.0", jobId: `job-${randomUUID().slice(0, 16)}`, taskId: a.taskId, robotId: d.robotId, robotWallet: d.robotWallet, agentId: h.agentId, price: h.price, deadline: jobDeadline }).catch(() => undefined);
  }

  // ---- drive to the checkpoint and look
  move("EXECUTING", `driving to ${route.checkpoint}`);
  const go = await local.startMission({ taskId: a.taskId, episodeId, waypoints: [route.checkpoint], captureKeyframe: true });
  if (!go.accepted) return finish("FAILED", `mission rejected: ${go.message}`);
  const res = await local.waitMission(d.missionTimeoutMs ?? 300_000);
  mission.push(res);
  if (!res) {
    await local.cancel();
    return finish("FAILED", "mission timed out");
  }
  if (!res.success) return finish(res.outcome === "ABORTED_SAFETY" ? "SAFE_STOP" : "FAILED", `mission ${res.outcome}: ${res.message}`);
  const frame = res.keyframePaths.at(-1);
  if (!frame) return finish("FAILED", "no keyframe captured");
  const img = await local.keyframe(frame);

  // ---- ask the vision agent (0G private inference) — at most twice, never invented
  const agent = agents.find((x) => x.agentId === vision.agentId)!;
  let answer: { action: string; confidence: number; observation: string } | null = null;
  for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
    const jobId = `job-${randomUUID().slice(0, 16)}`;
    const t0 = Date.now();
    let r;
    try {
      r = await Promise.race([
        platform.runJob(agent.agentId, {
          jobId, parentTaskId: a.taskId, requestingRobotId: d.robotId, targetAgentId: agent.agentId, capabilityId: agent.capabilities[0]!.capabilityId,
          input: { image: img.dataUrl, context: `checkpoint ${route.checkpoint}` }, budgetLimit: agent.price.amount,
          deadline: new Date(Date.now() + (d.inferenceTimeoutMs ?? 45_000)).toISOString(), idempotencyKey: jobId,
        }),
        new Promise<null>((ok) => setTimeout(() => ok(null), d.inferenceTimeoutMs ?? 45_000)),
      ]);
    } catch {
      r = undefined;
    }
    const base = { at: new Date().toISOString(), checkpoint: route.checkpoint, agentId: agent.agentId, model: agent.inference?.model ?? "", trustMode: agent.inference?.trustMode ?? "", latencyMs: Date.now() - t0 };
    if (!r || r.status !== "succeeded") {
      decisions.push({ ...base, providerRequestId: r?.receipt?.providerRequestId, outcome: r ? "failed" : "timeout", action: "hold" });
      await local.hold(true);
      move("WAITING_FOR_0G", r ? (r.reason ?? r.status) : "no answer before the deadline");
      continue;
    }
    const out = VisionInspectionOutput.safeParse(r.output);
    const ok = out.success && ACTIONS.has(out.data.recommended_action) && out.data.confidence >= CONFIDENCE_FLOOR;
    decisions.push({ ...base, latencyMs: r.receipt?.latencyMs ?? base.latencyMs, providerRequestId: r.receipt?.providerRequestId, outcome: ok ? "accepted" : "rejected", action: ok ? out.data.recommended_action : "hold" });
    if (ok) answer = { action: out.data.recommended_action, confidence: out.data.confidence, observation: out.data.observation };
    else {
      await local.hold(true);
      move("WAITING_FOR_0G", out.success ? `confidence ${out.data.confidence} below ${CONFIDENCE_FLOOR}` : "answer did not match the required format");
    }
  }
  if (!answer) {
    await local.hold(true); // stays held; only a new assignment or an operator moves it
    return finish("SAFE_STOP", "no valid 0G decision after two attempts; holding position, nothing invented");
  }
  await local.hold(false);

  // ---- act on the decision, within bounds
  move("VERIFYING", `${answer.observation}: ${answer.action} (${answer.confidence})`);
  if (answer.action === "abort_mission") return finish("ABORTED", "vision agent recommended abort; stopped at the checkpoint");
  if (answer.action === "pause_and_request_inspection") {
    await local.hold(true);
    return finish("COMPLETED", "finding reported; holding at the checkpoint for a human inspection");
  }
  const next = answer.action === "return_to_dock" ? ["dock"] : route.after;
  move("EXECUTING", `continuing to ${next.join(", ")}`);
  const go2 = await local.startMission({ taskId: a.taskId, episodeId, waypoints: next, captureKeyframe: false });
  if (!go2.accepted) return finish("FAILED", `second leg rejected: ${go2.message}`);
  const res2 = await local.waitMission(d.missionTimeoutMs ?? 300_000);
  mission.push(res2);
  if (!res2?.success) return finish(res2?.outcome === "ABORTED_SAFETY" ? "SAFE_STOP" : "FAILED", `second leg ${res2?.outcome ?? "timed out"}`);
  return finish("COMPLETED", `inspected ${route.checkpoint}, finished at ${next.at(-1)}`);
}
