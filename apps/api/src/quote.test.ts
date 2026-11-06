import { test } from "node:test";
import assert from "node:assert/strict";
import { agentJobPrice, fromMicro, quoteTask, toMicro, type QuoteInput } from "@semmal/quote";

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
  assert.deepEqual(q.hired.map((h) => h.agentId), ["v1"]); // inspection planning is not used by this skill, so not bought
  // inference is inside the agents' prices: no separate line (no double charge), only a note
  assert.equal(q.lines.find((l) => l.source === "0g-router"), undefined);
  assert.ok(q.notes.some((n) => n.includes("0.060423 0G")));
  // operating: ceil(120/30 + 3*1.5) = 9 min x 0.0004 = 0.0036
  assert.equal(q.lines.find((l) => l.label === "Operating time")!.amount, "0.0036");
  // vision is bought once per stop: 3 x 0.40 = 1.20
  assert.equal(q.lines.find((l) => l.label === "Lumen Vision")!.amount, "1.20");
  // cost 1.20 + 0.0036 = 1.2036 ; margin 25% -> 1.5045 -> raised to minFee 5
  assert.equal(q.cost, "1.2036");
  assert.equal(q.quote, "5.00");
  const top = q.lines.find((l) => l.label === "Minimum fee top-up")!;
  assert.equal(top.amount, "3.4955");
});

test("verified-only agents are not hired for a private task", () => {
  const q = quoteTask({ ...base, offers: base.offers.filter((o) => o.agentId !== "v1") });
  assert.equal(q.status, "declined");
});

test("the quote needs no 0G catalog price: agents price their own inference", () => {
  const q = quoteTask({ ...base, inference: null });
  assert.equal(q.status, "ok");
});

test("over the spend cap or the maximum quote: declined, never squeezed", () => {
  assert.equal(quoteTask({ ...base, policy: { ...base.policy, maxSpendPerTask: "1" } }).status, "declined");
  assert.equal(quoteTask({ ...base, policy: { ...base.policy, minFee: "0.5", maxQuote: "1" } }).status, "declined");
});

test("caps at the maximum quote when it still covers cost", () => {
  const q = quoteTask({ ...base, policy: { minFee: "0.5", maxQuote: "1.5", marginPct: 50, maxSpendPerTask: "10" } });
  assert.equal(q.status, "ok");
  if (q.status === "ok") {
    assert.equal(q.quote, "1.50");
    assert.ok(q.lines.some((l) => l.label === "Capped at maximum quote" && l.amount.startsWith("-")));
  }
});

test("the lines always add up to the quote", () => {
  for (const policy of [base.policy, { minFee: "0.5", maxQuote: "1.5", marginPct: 50, maxSpendPerTask: "10" }, { minFee: "0.5", maxQuote: "90", marginPct: 10, maxSpendPerTask: "10" }]) {
    const q = quoteTask({ ...base, policy });
    if (q.status !== "ok") continue;
    const sum = q.lines.reduce((a, l) => a + toMicro(l.amount.replace("-", "")) * (l.amount.startsWith("-") ? -1n : 1n), 0n);
    assert.equal(fromMicro(sum), q.quote);
  }
});

test("agent price in 0G = one job's live model cost plus margin, never below 0.0001", () => {
  // vision: 1500*4.83e12 + 800*1.612e13 = 2.0141e16 neuron = 0.020141 0G ; +50% = 0.030212 (rounded up)
  const p = agentJobPrice("vision", { promptNeuron: "4830000000000", completionNeuron: "16120000000000" }, 50);
  assert.equal(p.cost, "0.020141");
  assert.equal(p.price, "0.030212");
  assert.equal(agentJobPrice("navigation", { promptNeuron: "1", completionNeuron: "1" }, 0).price, "0.0001");
});
