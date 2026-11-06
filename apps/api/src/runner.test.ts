import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentListing } from "@semmal/contracts";
import { ZeroGError } from "@semmal/zerog-pc-adapter";
import { AgentRunner, extractJson } from "./runner";

const listing: AgentListing = {
  schemaVersion: "1.0", agentId: "agt-panel-vision-abc123", ownerWallet: "0x00000000000000000000000000000000000000aa",
  displayName: "Panel Vision", kind: "vision", summary: "x", endpoint: "http://localhost:3000/agents/agt-panel-vision-abc123/jobs",
  capabilities: [{ capabilityId: "vision.inspection", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", supportedRobotTypes: ["diff-drive-indoor"], supportedTaskTypes: ["warehouse.inspection"] }],
  price: { amount: "0.05", token: "0G", unit: "job" }, inference: { model: "m-vision", trustMode: "private" },
  delegation: { allowed: false, maxBudgetShare: 0 }, serviceVersion: "1.0.0",
};
const IMG = "data:image/png;base64,iVBORw0KGgo=";
const job = (over: Record<string, unknown> = {}) => ({
  jobId: "job-000001", parentTaskId: "task-1", requestingRobotId: "rbt-1", targetAgentId: listing.agentId, capabilityId: "vision.inspection",
  input: { image: IMG }, budgetLimit: "0.10", deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: `idem-${Math.random()}`, ...over,
});
const GOOD = '```json\n{"observation":"machine_panel","anomaly_detected":true,"anomaly_type":"possible_obstruction","confidence":0.87,"recommended_action":"pause_and_request_inspection"}\n```';

// test double for the 0G router: records calls, returns a scripted reply
function fakeRouter(reply: () => Promise<{ output: string; trustEvidence?: string }>) {
  const calls: unknown[] = [];
  return {
    calls,
    router: {
      config: { timeoutMs: 30_000 },
      chat: async (req: unknown) => {
        calls.push(req);
        const r = await reply();
        return { correlationId: "c", provenance: "ZEROG_ROUTER", providerRequestId: "req-123", chatId: "chat-1", providerAddress: "0xprov", model: "m-vision", requestedTrustMode: "private", trustEvidence: r.trustEvidence ?? "tee_verified", output: r.output, latencyMs: 812 };
      },
    },
  };
}
const make = (reply: () => Promise<{ output: string; trustEvidence?: string }>, l: AgentListing | null = listing) => {
  const f = fakeRouter(reply);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = new AgentRunner(f.router as any, async () => l, join(mkdtempSync(join(tmpdir(), "semmal-run-")), "jobs.db"));
  return { runner, calls: f.calls };
};

test("extractJson tolerates fences, nothing more", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(extractJson("no json here"), undefined);
});

test("a good vision job succeeds with a receipt that carries the provider request id", async () => {
  const { runner, calls } = make(async () => ({ output: GOOD }));
  const r = await runner.run(listing.agentId, job());
  assert.equal(r.status, "succeeded");
  assert.equal((r.output as { recommended_action: string }).recommended_action, "pause_and_request_inspection");
  assert.equal(r.receipt?.providerRequestId, "req-123");
  assert.match(r.receipt!.receiptHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.cost, { amount: "0.05", token: "0G" });
  const sent = calls[0] as { trustRequirement: string; model: string };
  assert.equal(sent.trustRequirement, "private");
  assert.equal(sent.model, "m-vision");
});

test("the same idempotency key returns the stored result without a second 0G call", async () => {
  const { runner, calls } = make(async () => ({ output: GOOD }));
  const j = job({ idempotencyKey: "idem-fixed-1" });
  const a = await runner.run(listing.agentId, j);
  const b = await runner.run(listing.agentId, j);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test("checks happen before 0G is called", async () => {
  const { runner, calls } = make(async () => ({ output: GOOD }));
  assert.equal((await runner.run(listing.agentId, { nope: 1 })).status, "rejected");
  assert.equal((await runner.run(listing.agentId, job({ targetAgentId: "agt-other-000000" }))).status, "rejected");
  assert.equal((await runner.run(listing.agentId, job({ budgetLimit: "0.01" }))).status, "rejected");
  assert.equal((await runner.run(listing.agentId, job({ deadline: new Date(Date.now() - 5_000).toISOString() }))).status, "rejected");
  assert.equal((await runner.run(listing.agentId, job({ capabilityId: "vision.other" }))).status, "rejected");
  assert.equal((await runner.run(listing.agentId, job({ input: { context: "no image" } }))).status, "rejected");
  assert.equal(calls.length, 0);
  const missing = make(async () => ({ output: GOOD }), null);
  assert.equal((await missing.runner.run(listing.agentId, job())).status, "rejected");
});

test("an answer outside the schema fails; nothing is repaired or invented", async () => {
  const { runner } = make(async () => ({ output: '{"observation":"panel","recommended_action":"set_motor_pwm"}' }));
  const r = await runner.run(listing.agentId, job());
  assert.equal(r.status, "failed");
  assert.equal(r.output, undefined);
  assert.equal(r.receipt?.providerRequestId, "req-123");
});

test("a failed TEE verification is not used", async () => {
  const { runner } = make(async () => ({ output: GOOD, trustEvidence: "tee_verification_failed" }));
  const r = await runner.run(listing.agentId, job());
  assert.equal(r.status, "failed");
  assert.equal(r.output, undefined);
});

test("no private provider: fails closed and says so", async () => {
  const { runner } = make(async () => { throw new ZeroGError("503", "no_provider_for_trust_mode", 503, "req-err"); });
  const r = await runner.run(listing.agentId, job());
  assert.equal(r.status, "failed");
  assert.match(r.reason!, /not downgraded/);
  assert.deepEqual(r.evidenceRefs, ["req-err"]);
});

// ---------------------------------------------------------------- payments and per-agent keys
const ROBOT = { kind: "robot" as const, robotId: "rbt-1", robotWallet: "0x00000000000000000000000000000000000000bb" };
const TX = `0x${"ab".repeat(32)}`;
function paid(check: (w: { to: string; from: string; minWei: bigint; memo: string }) => { ok: boolean; reason?: string }, mgmt = "") {
  const f = fakeRouter(async () => ({ output: GOOD }));
  const keys: unknown[] = [];
  const keyArgs: unknown[] = [];
  const router = {
    ...f.router,
    config: { timeoutMs: 30_000, managementKey: mgmt },
    chat: async (req: unknown, opts: unknown) => { keys.push(opts); return f.router.chat(req); },
    createKey: async (k: unknown) => { keyArgs.push(k); return { key: "sk-agent-secret", keyId: "k1", currency: "0g", creditLimit: "0.5" }; },
  };
  const seen: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = new AgentRunner(router as any, async () => listing, join(mkdtempSync(join(tmpdir(), "semmal-pay-")), "jobs.db"), async (w) => {
    seen.push(w);
    const r = check(w);
    return r.ok ? { ok: true, from: w.from as `0x${string}`, to: w.to as `0x${string}`, valueWei: w.minWei, blockNumber: 1n, confirmations: 1n } : { ok: false, reason: r.reason! };
  });
  return { runner, calls: f.calls, seen, keys, keyArgs };
}

test("a robot's job runs only after its 0G payment to the agent owner checks out", async () => {
  const t = paid(() => ({ ok: true }));
  assert.match((await t.runner.run(listing.agentId, job(), ROBOT)).reason!, /must carry its 0G payment/);
  const r = await t.runner.run(listing.agentId, job({ payment: { txHash: TX } }), ROBOT);
  assert.equal(r.status, "succeeded");
  const w = t.seen[0] as { to: string; from: string; minWei: bigint; memo: string };
  assert.equal(w.to, listing.ownerWallet);
  assert.equal(w.from, ROBOT.robotWallet);
  assert.equal(w.minWei, 50_000_000_000_000_000n); // 0.05 0G
  assert.equal(Buffer.from(w.memo.slice(2), "hex").toString(), "semmal:job:job-000001");
  assert.equal(r.receipt!.paymentTx, TX);
});

test("a bad payment stops the job before 0G is called; one payment pays one job", async () => {
  const bad = paid(() => ({ ok: false, reason: "paid to a different address" }));
  const r = await bad.runner.run(listing.agentId, job({ payment: { txHash: TX } }), ROBOT);
  assert.equal(r.status, "rejected");
  assert.match(r.reason!, /different address/);
  assert.equal(bad.calls.length, 0);
  const t = paid(() => ({ ok: true }));
  assert.equal((await t.runner.run(listing.agentId, job({ payment: { txHash: TX } }), ROBOT)).status, "succeeded");
  const again = await t.runner.run(listing.agentId, job({ jobId: "job-000002", payment: { txHash: TX } }), ROBOT);
  assert.match(again.reason!, /already paid for another job/);
  assert.equal(t.calls.length, 1);
});

test("a robot cannot run a job in another robot's name or pay an agent not priced in 0G", async () => {
  const t = paid(() => ({ ok: true }));
  assert.match((await t.runner.run(listing.agentId, job({ requestingRobotId: "rbt-2", payment: { txHash: TX } }), ROBOT)).reason!, /calling robot/);
  assert.equal(t.calls.length, 0);
});

test("with a management key each agent gets its own capped Router key, created once", async () => {
  const t = paid(() => ({ ok: true }), "mk-test");
  await t.runner.run(listing.agentId, job(), { kind: "owner" });
  await t.runner.run(listing.agentId, job(), { kind: "owner" });
  assert.equal(t.keyArgs.length, 1);
  assert.deepEqual(t.keyArgs[0], { name: `semmal-${listing.agentId}`, creditLimit: "0.5", resetPeriod: "daily", allowedModels: ["m-vision"], trustMode: "private" });
  assert.deepEqual(t.keys[1], { apiKey: "sk-agent-secret" });
  assert.ok(!JSON.stringify(t.runner.agentKeys()).includes("sk-agent-secret"), "the secret is never listed");
  const none = paid(() => ({ ok: true }));
  const r = await none.runner.run(listing.agentId, job(), { kind: "owner" });
  assert.match(r.receipt!.billing!, /shared platform Router key/);
});
