import { test } from "node:test";
import assert from "node:assert/strict";
import { expiresAt, quoteCreateArgs, taskRequestCreateArgs } from "@semmal/arkiv-adapter";

const W = "0x00000000000000000000000000000000000000aa";

test("offers expire at their own deadline, rounded to the 2 s block time", () => {
  const now = Date.parse("2026-11-06T10:00:00.000Z");
  const e = expiresAt("2026-11-06T10:05:01.000Z", now) as unknown as { minLifetime: bigint };
  assert.equal(e.minLifetime, 151n); // 301 s -> 302 s -> 151 blocks
  const past = expiresAt("2026-11-06T09:00:00.000Z", now) as unknown as { minLifetime: bigint };
  assert.equal(past.minLifetime, 2n); // never zero or negative
});

test("a booking and a quote encode with their indexed lookups", () => {
  const t = taskRequestCreateArgs({
    schemaVersion: "1.0", taskId: "task-abc123def", customerWallet: W, robotId: "rbt-1234567890", skill: "warehouse.inspection",
    plan: { waypoints: 3, distanceM: 120, privacy: "private" }, area: "Chennai", maxBudget: "20", deadline: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(t.values.task_id, "task-abc123def");
  assert.equal(t.values.skill, "warehouse.inspection");
  assert.throws(() => quoteCreateArgs({ schemaVersion: "1.0", quoteId: "nope", taskId: "t", robotId: "r", robotWallet: W, amount: "1", cost: "1", lines: [], validUntil: new Date().toISOString() }));
});
