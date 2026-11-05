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
  price: { amount: "0.05", token: "USDC", unit: "job" }, inference: { model: "m-vision", trustMode: "private" },
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
  assert.deepEqual(r.cost, { amount: "0.05", token: "USDC" });
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
