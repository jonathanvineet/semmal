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

// ---------------------------------------------------------------- job score (task-score-v1)
import { scoreTask, TASK_SCORE_FORMULA } from "@semmal/contracts";
import { episodeV2CreateArgs } from "@semmal/arkiv-adapter";

const base = { outcome: "COMPLETED" as const, planned: 3, visited: 3, decisionsAsked: 3, decisionsAccepted: 3, findings: 2, findingsHandled: 2, extrasAccepted: 1, extrasDone: 1, deadline: "2026-11-06T13:00:00Z", endedAt: "2026-11-06T12:30:00Z" };

test("a job done fully, on time, with every finding handled scores 100 and shows every part", () => {
  const s = scoreTask(base);
  assert.equal(s.formula, TASK_SCORE_FORMULA);
  assert.equal(s.score, 100);
  assert.deepEqual(s.parts.map((p) => [p.id, p.points, p.max]), [["completion", 40, 40], ["decisions", 20, 20], ["findings", 20, 20], ["extras", 10, 10], ["onTime", 10, 10]]);
});

test("missed stops, a rejected 0G answer, an unhandled finding and lateness each cost their share", () => {
  const s = scoreTask({ ...base, outcome: "FAILED", visited: 2, decisionsAccepted: 2, findingsHandled: 1, extrasDone: 0, endedAt: "2026-11-06T14:00:00Z" });
  // 40*2/3=27, 20*2/3=13, 20*1/2=10, 0, 0 -> 50 of 100
  assert.deepEqual(s.parts.map((p) => p.points), [27, 13, 10, 0, 0]);
  assert.equal(s.score, 50);
  assert.match(s.parts[4]!.detail, /after the deadline/);
});

test("parts that do not apply are not judged and leave the total", () => {
  const s = scoreTask({ ...base, findings: 0, findingsHandled: 0, extrasAccepted: 0, extrasDone: 0, deadline: null });
  assert.equal(s.max, 60);
  assert.equal(s.score, 100);
  assert.ok(s.parts.filter((p) => !p.judged).every((p) => /not judged/.test(p.detail)));
});

test("a safe stop is never misconduct: only the 0G decisions are judged", () => {
  const s = scoreTask({ ...base, outcome: "SAFE_STOP", visited: 1 });
  assert.equal(s.max, 20);
  assert.equal(s.score, 100);
});

test("score-v2: a robot's score is the mean of its own job scores (older episodes count 100 or 0)", () => {
  const withScore = (outcome: string, score: number) => ({ ...ep(outcome), score: { score } });
  const s = scoreRobot([withScore("COMPLETED", 90), withScore("COMPLETED", 70), ep("COMPLETED"), ep("FAILED"), withScore("SAFE_STOP", 0)], [], now);
  assert.equal(s.judged, 4);
  assert.equal(s.counts.scored, 2);
  assert.equal(s.score, 65); // (90 + 70 + 100 + 0) / 4; the safe stop is not judged
});

test("the episode v2 entity carries the job score as an indexed column and in the body", () => {
  const score = scoreTask(base);
  const args = episodeV2CreateArgs({
    schemaVersion: "1.0", episodeId: "ep-1", taskId: "task-abc123", robotId: "rbt-1", robotWallet: "0x" + "11".repeat(20),
    outcome: "COMPLETED", startedAt: "2026-11-06T12:00:00Z", endedAt: "2026-11-06T12:30:00Z", storageRoot: "0x" + "22".repeat(32),
    manifestHash: "0x" + "33".repeat(32), robotSignature: "0x1234", requestIds: [], agents: [], seqFrom: 0, seqTo: 3, score,
  });
  assert.equal(args.values.task_score, 100);
  assert.equal(JSON.parse(new TextDecoder().decode(args.values.body)).score.score, 100);
  assert.throws(() => episodeV2CreateArgs({ ...(JSON.parse(new TextDecoder().decode(args.values.body))), score: undefined }));
});

// ---------------------------------------------------------------- agents: robot-judged job scores, selection
import { scoreAgentJob, selectionScore } from "@semmal/contracts";

test("the hiring robot scores an agent job: delivered, passed its checks, speed", () => {
  assert.equal(scoreAgentJob({ delivered: true, passedChecks: true, latencyMs: 4000, deadlineMs: 45000 }).score, 100);
  assert.equal(scoreAgentJob({ delivered: true, passedChecks: true, latencyMs: 30000, deadlineMs: 45000 }).score, 90);
  assert.equal(scoreAgentJob({ delivered: true, passedChecks: false, latencyMs: 4000, deadlineMs: 45000 }).score, 60);
  assert.equal(scoreAgentJob({ delivered: false, passedChecks: false, latencyMs: 45000, deadlineMs: 45000 }).score, 0);
});

test("score-v2 for agents: the mean of the robots' job scores", () => {
  const j = (status: string, score: number) => ({ ...job(status), score: { score } });
  const s = scoreAgent([j("succeeded", 100), j("succeeded", 60), j("failed", 0), job("rejected")], now);
  assert.equal(s.judged, 3);
  assert.equal(s.score, 53);
  assert.equal(s.counts.scored, 3);
});

test("selection: little evidence is pulled toward 70; a long record speaks for itself; excluded is never selected", () => {
  assert.equal(selectionScore({ score: 100, judged: 1, status: "new" }), 78); // (100 + 210) / 4
  assert.equal(selectionScore({ score: 100, judged: 0, status: "new" }), 70);
  assert.equal(selectionScore({ score: 90, judged: 27, status: "good" }), 88); // (2430 + 210) / 30
  assert.equal(selectionScore({ score: 20, judged: 10, status: "excluded" }), null);
});
