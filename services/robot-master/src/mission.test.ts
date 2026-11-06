import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentListing, AgentResult, RobotProfile } from "@semmal/contracts";
import { runTask, type Assignment, type EpisodeRecord } from "./mission";
import { TaskStore } from "./store";
import type { LocalApi, LocalState, MissionResult } from "./local";
import type { PlatformApi } from "./platform";

const W = "0x00000000000000000000000000000000000000ab";
const robot: RobotProfile = {
  schemaVersion: "1.0", robotId: "rbt-test", robotWallet: W, ownerWallet: "0x00000000000000000000000000000000000000cd",
  displayName: "Rover", model: "rover", robotType: "diff-drive-indoor", hardware: { base: "x", sensors: ["lidar-2d"] },
  capabilities: ["warehouse.inspection"], rosInterfaceVersion: "0.1.0", profileVersion: 1, serviceArea: "Chennai",
  pricing: { token: "USDC", minFee: "2", maxQuote: "40", marginPct: 20, maxSpendPerTask: "10" },
};
const vision: AgentListing = {
  schemaVersion: "1.0", agentId: "agt-vision-000001", ownerWallet: W, displayName: "Panel Vision", kind: "vision", summary: "x",
  endpoint: "http://x/agents/agt-vision-000001/jobs",
  capabilities: [{ capabilityId: "vision.inspection", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", supportedRobotTypes: ["diff-drive-indoor"], supportedTaskTypes: ["warehouse.inspection"] }],
  price: { amount: "0.05", token: "USDC", unit: "job" }, inference: { model: "m-vis", trustMode: "private" }, delegation: { allowed: false, maxBudgetShare: 0 }, serviceVersion: "1.0.0",
};
const inspection: AgentListing = { ...vision, agentId: "agt-insp-000001", displayName: "Planner", kind: "inspection", price: { amount: "0.10", token: "USDC", unit: "job" } };

const ok = (action: string, confidence = 0.9): AgentResult => ({
  jobId: "j", agentId: vision.agentId, status: "succeeded",
  output: { observation: "machine_panel", anomaly_detected: action !== "continue_mission", anomaly_type: null, confidence, recommended_action: action },
  receipt: { jobId: "j", agentId: vision.agentId, model: "m-vis", requestedTrustMode: "private", trustEvidence: "tee_verified", providerRequestId: "req-777", latencyMs: 900, inputSha256: "a", outputSha256: "b", completedAt: new Date().toISOString(), receiptHash: "c" },
});

function harness(opts: { state?: Partial<LocalState>; job?: (input: { context?: string }) => Promise<AgentResult>; profile?: Partial<RobotProfile> } = {}) {
  const calls = { dwell: [] as number[], missions: [] as string[][], holds: [] as boolean[], jobs: 0, quotes: 0, claims: 0, acks: [] as [boolean, string?][], states: [] as string[], episodes: [] as EpisodeRecord[] };
  const result = (wps: string[]): MissionResult => ({ success: true, outcome: "COMPLETED", message: "ok", reached: wps, keyframePaths: ["/data/kf/a.ppm"] });
  let last: string[] = [];
  const local: LocalApi = {
    state: async () => ({ safetyState: "NORMAL", batteryPct: 90, zone: "dock", availability: "available", executor: true, missionPhase: "IDLE", activeTask: null, hold: false, world: "warehouse", waypoints: ["destination", "dock", "inspection_point_A"], ...opts.state }),
    startMission: async (g) => { calls.missions.push(g.waypoints); calls.dwell.push(g.dwellS ?? 0); last = g.waypoints; return { accepted: true, message: "ok" }; },
    waitMission: async () => result(last),
    cancel: async () => undefined,
    hold: async (on) => { calls.holds.push(on); },
    keyframe: async () => ({ dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 }),
  };
  const platform: PlatformApi = {
    robot: async () => ({ ...robot, ...opts.profile }),
    agents: async () => [vision, inspection],
    catalog: async () => ({ rate: "1", models: [{ id: "m-vis", promptNeuron: "1000000000", completionNeuron: "1000000000", verifiability: "TeeML" }] }),
    runJob: async (_id, job) => { calls.jobs++; return (opts.job ?? (async () => ok("continue_mission")))((job as { input: { context?: string } }).input); },
  };
  const store = new TaskStore(mkdtempSync(join(tmpdir(), "rm-")));
  const deps = {
    robotId: "rbt-test", robotWallet: W, local, platform, store,
    evidence: { quote: async () => { calls.quotes++; }, claim: async () => { calls.claims++; }, episode: async (e: EpisodeRecord) => { calls.episodes.push(e); } },
    progress: (s: string) => { calls.states.push(s); },
    ack: (_t: string, a: boolean, r?: string) => { calls.acks.push([a, r]); },
    inferenceTimeoutMs: 200,
  };
  return { calls, deps, store };
}
const task = (over: Partial<Assignment> = {}): Assignment => ({ taskId: `task-${Math.random().toString(36).slice(2, 10)}`, skill: "warehouse.inspection", plan: { waypoints: 1, distanceM: 120, privacy: "private" }, ...over });

test("the robot quotes, hires, looks, decides with 0G and finishes", async () => {
  const { calls, deps } = harness();
  const ep = await runTask(task(), deps);
  assert.equal(ep!.outcome, "COMPLETED");
  assert.deepEqual(calls.missions, [["inspection_point_A"], ["dock"]]);
  assert.equal(calls.quotes, 1);
  assert.equal(calls.claims, 2); // vision + inspection hired by the robot itself
  assert.deepEqual(calls.acks[0], [true, undefined]);
  assert.equal(ep!.decisions[0]!.providerRequestId, "req-777");
  assert.equal(ep!.decisions[0]!.outcome, "accepted");
  assert.equal(calls.episodes.length, 1);
});

test("0G fails twice: hold, SAFE_STOP, nothing invented, no further driving", async () => {
  const { calls, deps } = harness({ job: async () => ({ jobId: "j", agentId: vision.agentId, status: "failed", reason: "0G call failed (provider_error)" }) });
  const ep = await runTask(task(), deps);
  assert.equal(ep!.outcome, "SAFE_STOP");
  assert.equal(calls.jobs, 2);
  assert.deepEqual(calls.missions, [["inspection_point_A"]]);
  assert.ok(calls.holds.includes(true) && !calls.holds.includes(false));
  assert.ok(calls.states.includes("WAITING_FOR_0G"));
  assert.ok(ep!.decisions.every((d) => d.action === "hold"));
});

test("0G never answers: timeouts are treated the same", async () => {
  const { calls, deps } = harness({ job: () => new Promise(() => undefined) });
  const ep = await runTask(task(), deps);
  assert.equal(ep!.outcome, "SAFE_STOP");
  assert.equal(ep!.decisions.filter((d) => d.outcome === "timeout").length, 2);
  assert.equal(calls.missions.length, 1);
});

test("an unsupported action or low confidence is rejected, not acted on", async () => {
  const bad = harness({ job: async () => ({ ...ok("continue_mission"), output: { observation: "x", anomaly_detected: false, anomaly_type: null, confidence: 0.9, recommended_action: "set_motor_pwm" } }) });
  assert.equal((await runTask(task(), bad.deps))!.outcome, "SAFE_STOP");
  const low = harness({ job: async () => ok("continue_mission", 0.3) });
  const ep = await runTask(task(), low.deps);
  assert.equal(ep!.outcome, "SAFE_STOP");
  assert.equal(low.calls.missions.length, 1);
});

test("pause_and_request_inspection keeps the robot held at the checkpoint", async () => {
  const { calls, deps } = harness({ job: async () => ok("pause_and_request_inspection") });
  const ep = await runTask(task(), deps);
  assert.equal(ep!.outcome, "COMPLETED");
  assert.equal(calls.missions.length, 1);
  assert.equal(calls.holds.at(-1), true);
});

test("declines when the robot is not NORMAL or the quote is over budget", async () => {
  const notReady = harness({ state: { safetyState: "E_STOP" } });
  assert.equal(await runTask(task(), notReady.deps), null);
  assert.equal(notReady.calls.acks[0]![0], false);
  assert.equal(notReady.calls.missions.length, 0);
  const cheap = harness();
  assert.equal(await runTask(task({ maxBudget: "0.5" }), cheap.deps), null);
  assert.match(cheap.calls.acks[0]![1]!, /over the customer's budget/);
});

test("a re-delivered task is never run twice", async () => {
  const { calls, deps } = harness();
  const t = task();
  await runTask(t, deps);
  assert.equal(await runTask(t, deps), null);
  assert.equal(calls.missions.length, 2);
});

test("the episode says what the robot accessed and what it bought", async () => {
  const { deps } = harness();
  const ep = (await runTask(task(), deps))!;
  assert.equal(ep.world, "warehouse");
  assert.ok(ep.access.some((a) => a.what === "camera frame" && a.leftRobot));
  assert.ok(ep.access.some((a) => a.source === "Arkiv registry"));
  assert.ok(!JSON.stringify(ep).includes("base64"), "no image bytes in the evidence");
  assert.deepEqual(ep.purchases.map((p) => [p.agentId, p.status, p.providerRequestId]), [[vision.agentId, "delivered", "req-777"]]);
  assert.equal(ep.spend.agentsUsdc, "0.05");
  assert.equal(ep.spend.quotedUsdc, ep.quote!.amount);
});

const house = { world: "house", waypoints: ["bathroom", "bedroom", "dock", "inspection_point_A", "kitchen", "living_room", "office", "guest_room"] };
const cleaner = { capabilities: ["home.cleaning" as const], model: "cleaner" as const };

test("house cleaning: visits rooms, cleans where the camera finds mess, skips clean rooms, returns", async () => {
  const { calls, deps } = harness({
    state: house,
    profile: cleaner,
    job: async (input) => (/kitchen|living room/.test(input.context ?? "") ? ok("pause_and_request_inspection") : ok("continue_mission")),
  });
  const ep = (await runTask(task({ skill: "home.cleaning", plan: { waypoints: 3, distanceM: 60, privacy: "private" } }), deps))!;
  assert.equal(ep.outcome, "COMPLETED");
  assert.deepEqual(ep.stops, ["kitchen", "living_room", "bedroom"]);
  assert.deepEqual(calls.missions, [["kitchen"], ["kitchen"], ["living_room"], ["living_room"], ["bedroom"], ["dock"]]);
  assert.equal(calls.dwell.filter((x) => x > 0).length, 2); // two cleaning passes
  assert.deepEqual(ep.actions.map((a) => a.stop + ":" + a.action.split(" ")[0]), ["kitchen:cleaning", "living_room:cleaning", "bedroom:nothing"]);
  assert.equal(ep.purchases.length, 3);
});

test("forest patrol: hazards are reported and the patrol continues to every stop", async () => {
  const { calls, deps } = harness({
    state: { world: "forest", waypoints: ["creek_crossing", "dock", "fire_lookout", "log_check"] },
    profile: { capabilities: ["outdoor.patrol"], robotType: "diff-drive-outdoor", model: "field-rover" },
    job: async (input) => (/log check|fire lookout/.test(input.context ?? "") ? ok("pause_and_request_inspection") : ok("continue_mission")),
  });
  const ep = (await runTask(task({ skill: "outdoor.patrol", plan: { waypoints: 3, distanceM: 40, privacy: "private" } }), deps))!;
  assert.equal(ep.outcome, "COMPLETED");
  assert.deepEqual(calls.missions, [["creek_crossing"], ["log_check"], ["fire_lookout"], ["dock"]]);
  assert.equal(ep.actions.filter((a) => a.action.startsWith("hazard")).length, 2);
  assert.ok(!calls.holds.includes(true));
});

test("declines a job the current world cannot serve", async () => {
  const { calls, deps } = harness({ state: { world: "forest", waypoints: ["dock", "log_check"] }, profile: cleaner });
  assert.equal(await runTask(task({ skill: "home.cleaning" }), deps), null);
  assert.match(calls.acks[0]![1]!, /has none of the stops/);
  assert.equal(calls.missions.length, 0);
});
