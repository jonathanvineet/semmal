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
import type { TransferCheck } from "@semmal/zerog-pay";

const W = "0x00000000000000000000000000000000000000ab";
const robot: RobotProfile = {
  schemaVersion: "1.0", robotId: "rbt-test", robotWallet: W, ownerWallet: "0x00000000000000000000000000000000000000cd",
  displayName: "Rover", model: "rover", robotType: "diff-drive-indoor", hardware: { base: "x", sensors: ["lidar-2d"] },
  capabilities: ["warehouse.inspection"], rosInterfaceVersion: "0.1.0", profileVersion: 1, serviceArea: "Chennai",
  pricing: { token: "0G", minFee: "2", maxQuote: "40", marginPct: 20, maxSpendPerTask: "10" },
};
const vision: AgentListing = {
  schemaVersion: "1.0", agentId: "agt-vision-000001", ownerWallet: W, displayName: "Panel Vision", kind: "vision", summary: "x",
  endpoint: "http://x/agents/agt-vision-000001/jobs",
  capabilities: [{ capabilityId: "vision.inspection", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", supportedRobotTypes: ["diff-drive-indoor"], supportedTaskTypes: ["warehouse.inspection"] }],
  price: { amount: "0.05", token: "0G", unit: "job" }, inference: { model: "m-vis", trustMode: "private" }, delegation: { allowed: false, maxBudgetShare: 0 }, serviceVersion: "1.0.0",
};
const inspection: AgentListing = { ...vision, agentId: "agt-insp-000001", displayName: "Planner", kind: "inspection", price: { amount: "0.10", token: "0G", unit: "job" } };

const ok = (action: string, confidence = 0.9): AgentResult => ({
  jobId: "j", agentId: vision.agentId, status: "succeeded",
  output: { observation: "machine_panel", anomaly_detected: action !== "continue_mission", anomaly_type: null, confidence, recommended_action: action },
  receipt: { jobId: "j", agentId: vision.agentId, model: "m-vis", requestedTrustMode: "private", trustEvidence: "tee_verified", providerRequestId: "req-777", latencyMs: 900, inputSha256: "a", outputSha256: "b", completedAt: new Date().toISOString(), receiptHash: "c" },
});

type HarnessOpts = {
  state?: Partial<LocalState>;
  job?: (input: { context?: string }) => Promise<AgentResult>;
  profile?: Partial<RobotProfile>;
  /** what the customer's payment check returns; defaults to a matching payment of `paidWei` */
  incoming?: (w: { minWei: bigint; from: string }) => TransferCheck;
  paidWei?: bigint;
  payTx?: string | null;
  payFails?: (to: string) => boolean;
};
function harness(opts: HarnessOpts = {}) {
  const calls = { positions: [] as { phase: string; lat: number; lon: number }[], pays: [] as { to: string; wei: bigint; kind: string; id: string }[], dwell: [] as number[], missions: [] as string[][], holds: [] as boolean[], jobs: 0, quotes: 0, claims: 0, acks: [] as [boolean, string?][], states: [] as string[], episodes: [] as EpisodeRecord[] };
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
    route: async (from, to) => ({ source: "osrm" as const, distanceM: 1200, durationS: 600, coords: [[from.lat, from.lon], [(from.lat + to.lat) / 2, (from.lon + to.lon) / 2], [to.lat, to.lon]] as [number, number][] }),
    runJob: async (_id, job) => { calls.jobs++; return (opts.job ?? (async () => ok("continue_mission")))((job as { input: { context?: string } }).input); },
  };
  const store = new TaskStore(mkdtempSync(join(tmpdir(), "rm-")));
  let n = 0;
  const deps = {
    robotId: "rbt-test", robotWallet: W, local, platform, store,
    wallet: {
      pay: async (p: { to: string; wei: bigint; kind: string; id: string }) => {
        if (opts.payFails?.(p.to)) throw new Error("insufficient funds");
        calls.pays.push(p);
        return { txHash: `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`, status: "success" as const };
      },
      checkIncoming: async (w: { minWei: bigint; from: string }): Promise<TransferCheck> =>
        opts.incoming ? opts.incoming(w) : { ok: true, from: w.from as `0x${string}`, to: W, valueWei: opts.paidWei ?? w.minWei, blockNumber: 1n, confirmations: 1n },
    },
    awaitPayment: async () => (opts.payTx === undefined ? `0x${"cc".repeat(32)}` : opts.payTx),
    paymentPollMs: 1,
    base: { lat: 13.0827, lon: 80.2707 },
    travelSpeedup: 6000, // 600 s of driving in 0.1 s
    travelTickMs: 10,
    position: (p: { phase: string; lat: number; lon: number }) => { calls.positions.push(p); },
    quoteValidMs: 300,
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
  assert.equal(calls.claims, 1); // the vision agent, hired by the robot itself
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
  assert.deepEqual(ep.purchases.map((p) => [p.agentId, p.status, p.paymentStatus, p.providerRequestId]), [[vision.agentId, "delivered", "paid", "req-777"]]);
  assert.equal(ep.money.agentsPaid0G, "0.05");
  assert.equal(ep.money.funding, "robot's own balance (owner test task)");
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

// ---------------------------------------------------------------- money
const CUSTOMER = "0x00000000000000000000000000000000000000ee";
const OWNER = robot.ownerWallet;

test("a customer task waits for the payment, pays the agent's owner per job, then pays the owner the margin", async () => {
  const { calls, deps } = harness();
  const ep = (await runTask(task({ customerWallet: CUSTOMER }), deps))!;
  assert.equal(ep.outcome, "COMPLETED");
  assert.equal(ep.money.funding, "customer payment");
  assert.equal(ep.money.customerPayment!.from, CUSTOMER);
  const quoted = ep.quote!.amount;
  assert.equal(ep.money.customerPayment!.amount0G, quoted);
  assert.deepEqual(calls.pays.map((p) => [p.kind, p.to]), [["job", W], ["payout", OWNER]]); // vision owner is W in this fixture
  assert.equal(calls.pays[0]!.wei, 50_000_000_000_000_000n);
  assert.equal(ep.money.payout!.status, "success");
  assert.ok(calls.states.includes("AWAITING_PAYMENT") && calls.states.includes("PAID"));
  assert.ok(calls.states.indexOf("PAID") < calls.states.indexOf("EXECUTING"), "nothing moves before the payment checks out");
});

test("no payment before the quote expires: nothing is done and nothing is paid", async () => {
  const { calls, deps, store } = harness({ payTx: null });
  const t = task({ customerWallet: CUSTOMER });
  assert.equal(await runTask(t, deps), null);
  assert.equal(calls.missions.length, 0);
  assert.equal(calls.pays.length, 0);
  assert.equal(store.history(t.taskId).at(-1)!.state, "ABORTED");
});

test("a payment to the wrong place or too small is not accepted", async () => {
  const { calls, deps } = harness({ incoming: () => ({ ok: false, reason: "paid to a different address" }) });
  assert.equal(await runTask(task({ customerWallet: CUSTOMER }), deps), null);
  assert.equal(calls.jobs, 0);
  assert.equal(calls.pays.length, 0);
});

test("a failed run refunds what is left to the customer, not to the owner", async () => {
  const { calls, deps } = harness({ job: async () => ({ jobId: "j", agentId: vision.agentId, status: "failed", reason: "0G call failed" }) });
  const ep = (await runTask(task({ customerWallet: CUSTOMER }), deps))!;
  assert.equal(ep.outcome, "SAFE_STOP");
  assert.deepEqual(calls.pays.map((p) => [p.kind, p.to]), [["job", W], ["job", W], ["refund", CUSTOMER]]);
  assert.equal(ep.money.agentsPaid0G, "0.10"); // both paid attempts count; money spent is spent
  assert.ok(!ep.money.payout);
});

test("the quote declines a job whose agents would cost more than the owner's cap", async () => {
  const { calls, deps } = harness({ state: house, profile: { ...cleaner, pricing: { ...robot.pricing!, maxSpendPerTask: "0.05" } } });
  assert.equal(await runTask(task({ skill: "home.cleaning", plan: { waypoints: 3, distanceM: 60, privacy: "private" } }), deps), null);
  assert.match(calls.acks[0]![1]!, /over the owner's cap/);
  assert.equal(calls.pays.length, 0);
});

test("during the run the robot never spends past its agent budget (a retry that would is refused)", async () => {
  let first = true;
  const { calls, deps } = harness({
    profile: { pricing: { ...robot.pricing!, maxSpendPerTask: "0.06" } },
    job: async () => (first ? ((first = false), { jobId: "j", agentId: vision.agentId, status: "failed" as const, reason: "bad answer" }) : ok("continue_mission")),
  });
  const ep = (await runTask(task(), deps))!;
  assert.equal(ep.outcome, "SAFE_STOP");
  assert.equal(calls.pays.filter((p) => p.kind === "job").length, 1);
  assert.match(ep.purchases.at(-1)!.status, /over the task's agent budget/);
  assert.equal(calls.jobs, 1);
});

test("if the agent payment fails, the job is not sent and the robot holds", async () => {
  const { calls, deps } = harness({ payFails: (to) => to === W });
  const ep = (await runTask(task(), deps))!;
  assert.equal(ep.outcome, "SAFE_STOP");
  assert.equal(calls.jobs, 0);
  assert.ok(calls.holds.includes(true));
  assert.match(ep.purchases[0]!.paymentStatus, /insufficient funds/);
});

test("a robot priced in another token takes no paid tasks", async () => {
  const { calls, deps } = harness({ profile: { pricing: { ...robot.pricing!, token: "USDC" as never } } });
  assert.equal(await runTask(task(), deps), null);
  assert.match(calls.acks[0]![1]!, /not in 0G/);
});

test("a job at the customer's site: the robot travels there, reports its position, then works", async () => {
  const site = { lat: 13.0611, lon: 80.2547 };
  const { calls, deps } = harness();
  const ep = (await runTask(task({ site, startAt: new Date(Date.now() + 50).toISOString() }), deps))!;
  assert.equal(ep.outcome, "COMPLETED");
  assert.ok(calls.positions.some((p) => p.phase === "TRAVELLING"));
  assert.deepEqual(calls.positions.at(-1), { taskId: ep.taskId, lat: site.lat, lon: site.lon, phase: "ARRIVED", remainingM: 0 });
  assert.ok(calls.states.indexOf("ARRIVED") < calls.states.indexOf("EXECUTING"), "works only after arriving");
  assert.deepEqual(ep.travel!.to, { lat: 13.06, lon: 80.25 }, "the evidence keeps only a ~1 km position");
  assert.ok(!JSON.stringify(ep).includes("13.0611"), "the exact site is not in the evidence");
});

test("without a base location the robot cannot plan the trip and says so", async () => {
  const { deps } = harness();
  const ep = (await runTask(task({ site: { lat: 13.06, lon: 80.25 } }), { ...deps, base: undefined }))!;
  assert.equal(ep.outcome, "FAILED");
  assert.match(ep.transitions.at(-1)!.reason, /no base location/);
});

test("a slow or stuck Arkiv write never holds up the job; the offer goes straight to the platform", async () => {
  const { deps } = harness();
  const offers: { amount: string; payTo: string }[] = [];
  const never = () => new Promise<void>(() => undefined);
  const ep = await runTask(task({ customerWallet: CUSTOMER }), {
    ...deps,
    evidence: { ...deps.evidence, quote: never, claim: never },
    offer: (o) => offers.push(o),
  });
  assert.equal(ep!.outcome, "COMPLETED");
  assert.equal(offers.length, 1);
  assert.equal(offers[0]!.payTo, W);
});

test("a task sent again is answered, not silently ignored", async () => {
  const { calls, deps } = harness();
  const t = task();
  await runTask(t, deps);
  assert.equal(await runTask(t, deps), null);
  assert.match(calls.acks.at(-1)![1]!, /already has this task \(COMPLETED/);
});

// ---------------------------------------------------------------- approve, travel, confirm, pay, work
const SITE = { lat: 13.0611, lon: 80.2547 };
test("the booking flow: owner approves, robot travels, customer confirms arrival, pays, then the robot works", async () => {
  const { calls, deps } = harness();
  const decisions: { outcome: string; receipt?: Record<string, unknown>; question: string; checks: { format: boolean } }[] = [];
  const ep = (await runTask(task({ customerWallet: CUSTOMER, site: SITE }), {
    ...deps,
    awaitOwner: async () => ({ approved: true }),
    awaitArrival: async () => true,
    decision: (x) => decisions.push(x),
  }))!;
  assert.equal(ep.outcome, "COMPLETED");
  const order = ["AWAITING_OWNER", "APPROVED", "TRAVELLING", "ARRIVED", "AWAITING_CONFIRMATION", "CONFIRMED", "AWAITING_PAYMENT", "PAID", "EXECUTING"].map((s) => calls.states.indexOf(s));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!)), `states out of order: ${calls.states.join(" > ")}`);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.outcome, "accepted");
  assert.equal(decisions[0]!.receipt?.providerRequestId, "req-777");
  assert.match(decisions[0]!.question, /inspection/i);
  assert.ok(decisions[0]!.checks.format);
});

test("the owner declines: the robot does not move and nothing is charged", async () => {
  const { calls, deps } = harness();
  const r = await runTask(task({ customerWallet: CUSTOMER, site: SITE }), { ...deps, awaitOwner: async () => ({ approved: false, reason: "busy that day" }) });
  assert.equal(r, null);
  assert.equal(calls.positions.length, 0);
  assert.equal(calls.pays.length, 0);
  assert.ok(calls.states.includes("ABORTED"));
});

test("the customer never confirms the arrival: no payment is taken, the trip is on record", async () => {
  const { calls, deps } = harness();
  const ep = (await runTask(task({ customerWallet: CUSTOMER, site: SITE }), { ...deps, awaitOwner: async () => ({ approved: true }), awaitArrival: async () => false }))!;
  assert.equal(ep.outcome, "ABORTED");
  assert.ok(ep.travel);
  assert.equal(calls.pays.length, 0);
  assert.equal(calls.jobs, 0);
});
