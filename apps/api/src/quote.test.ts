import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMicro, quoteTask, toMicro, type QuoteInput } from "@semmal/quote";

const base: QuoteInput = {
  robotType: "diff-drive-indoor",
  policy: { minFee: "5", maxQuote: "40", marginPct: 25, maxSpendPerTask: "10" },
  plan: { skill: "warehouse.inspection", waypoints: 3, distanceM: 120, checkpoints: 3, privacy: "private" },
  offers: [
    { agentId: "v1", name: "Lumen Vision", kind: "vision", price: "0.40", trustMode: "private" },
    { agentId: "v2", name: "Kestrel Vision", kind: "vision", price: "0.25", trustMode: "verified" },
    { agentId: "i1", name: "Ostra Inspection", kind: "inspection", price: "1.10", trustMode: "private" },
  ],
  inference: { model: "m", promptNeuron: "4830000000000", completionNeuron: "16120000000000" },
  zerogUsdcRate: "2.5",
};

test("money helpers are exact", () => {
  assert.equal(toMicro("12.5"), 12_500_000n);
  assert.equal(fromMicro(12_500_000n), "12.50");
  assert.equal(fromMicro(1n), "0.000001");
});

test("prices a task from its parts, hiring the private agents", () => {
  const q = quoteTask(base);
  assert.equal(q.status, "ok");
  if (q.status !== "ok") return;
  assert.deepEqual(q.hired.map((h) => h.agentId), ["v1", "i1"]);
  // inference: 3 x (1500*4.83e12 + 200*1.612e13) neuron = 3 x 1.0469e16 = 3.1407e16 neuron = 0.031407 0G x 2.5 = 0.0785175 -> 0.078518
  const inf = q.lines.find((l) => l.source === "0g-router")!;
  assert.equal(inf.usdc, "0.078518");
  // operating: ceil(120/30 + 3*1.5) = ceil(8.5) = 9 min x 0.04 = 0.36
  assert.equal(q.lines.find((l) => l.label === "Operating time")!.usdc, "0.36");
  // cost 0.40 + 1.10 + 0.078518 + 0.36 = 1.938518 ; margin 25% -> 0.48463 (rounded up) ; quote 2.423148 -> raised to minFee 5
  assert.equal(q.cost, "1.938518");
  assert.equal(q.quote, "5.00");
  assert.ok(q.notes.some((n) => n.includes("minimum fee")));
});

test("verified-only agents are not hired for a private task", () => {
  const q = quoteTask({ ...base, offers: base.offers.filter((o) => o.agentId !== "v1") });
  assert.equal(q.status, "declined");
});

test("declines instead of guessing a missing 0G price or rate", () => {
  assert.equal(quoteTask({ ...base, inference: null }).status, "declined");
  assert.equal(quoteTask({ ...base, zerogUsdcRate: null }).status, "declined");
});

test("over the spend cap or the maximum quote: declined, never squeezed", () => {
  assert.equal(quoteTask({ ...base, policy: { ...base.policy, maxSpendPerTask: "1" } }).status, "declined");
  assert.equal(quoteTask({ ...base, policy: { ...base.policy, minFee: "0.5", maxQuote: "1" } }).status, "declined");
});

test("caps at the maximum quote when it still covers cost", () => {
  const q = quoteTask({ ...base, policy: { minFee: "0.5", maxQuote: "2.1", marginPct: 50, maxSpendPerTask: "10" } });
  assert.equal(q.status, "ok");
  if (q.status === "ok") {
    assert.equal(q.quote, "2.10");
    assert.ok(q.notes.some((n) => n.includes("maximum quote")));
  }
});
