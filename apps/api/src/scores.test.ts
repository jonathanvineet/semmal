import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAgent, scoreRobot, ReputationCheckpoint } from "@semmal/contracts";
import { reputationCreateArgs } from "@semmal/arkiv-adapter";

const now = Date.parse("2026-11-06T12:00:00Z");
const ep = (outcome: string, daysAgo = 1) => ({ outcome, endedAt: new Date(now - daysAgo * 86_400_000).toISOString() });
const job = (status: string, daysAgo = 1) => ({ status, at: new Date(now - daysAgo * 86_400_000).toISOString() });

test("a correct safe stop or a cancelled job never lowers a robot's score", () => {
  const s = scoreRobot([ep("COMPLETED"), ep("COMPLETED"), ep("COMPLETED"), ep("SAFE_STOP"), ep("ABORTED")], [], now);
  assert.equal(s.score, 100);
  assert.equal(s.judged, 3);
  assert.equal(s.status, "good");
});

test("mission failures and hardware incidents lower a robot's score; a bad robot is excluded", () => {
  const s = scoreRobot([ep("COMPLETED"), ep("FAILED"), ep("FAILED"), ep("FAILED"), ep("FAILED")], [{ detectedAt: ep("x").endedAt }], now);
  assert.equal(s.score, 16); // 100*1/5 = 20, minus 20*(1 incident / 5 episodes) = 4
  assert.equal(s.status, "excluded");
});

test("new robots and agents are not judged on too little evidence", () => {
  assert.equal(scoreRobot([ep("FAILED")], [], now).status, "new");
  assert.equal(scoreAgent([job("failed"), job("failed")], now).status, "new");
});

test("an agent's bad answers lower its score; rejected jobs (input/payment) are not its fault", () => {
  const a = scoreAgent([job("succeeded"), job("failed"), job("failed"), job("failed"), job("failed"), job("rejected")], now);
  assert.equal(a.score, 20);
  assert.equal(a.status, "excluded");
  const b = scoreAgent([job("succeeded"), job("succeeded"), job("succeeded"), job("failed")], now);
  assert.equal(b.score, 75);
  assert.equal(b.status, "good");
});

test("anything unused for more than 180 days is excluded", () => {
  assert.match(scoreAgent([job("succeeded", 200), job("succeeded", 190), job("succeeded", 185)], now).reason, /no activity for 18\d days/);
  assert.equal(scoreRobot([ep("COMPLETED", 400)], [], now).status, "excluded");
});

test("a score checkpoint encodes for Arkiv with a 120-day lifetime", () => {
  const cp = ReputationCheckpoint.parse({
    schemaVersion: "1.0", formula: "score-v1", subjectKind: "agent", subjectId: "agt-vision-abc123", score: 75, status: "good", judged: 4,
    counts: { succeeded: 3, failed: 1 }, lastActiveAt: new Date(now).toISOString(), computedAt: new Date(now).toISOString(), publisherWallet: "0x0123456789012345678901234567890123456789",
  });
  const a = reputationCreateArgs(cp);
  assert.equal((a.options.expiration as unknown as { minLifetime: bigint }).minLifetime, 120n * 86_400n / 2n);
  assert.equal(a.values.subject_id, "agt-vision-abc123");
});
