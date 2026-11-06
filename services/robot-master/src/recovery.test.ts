import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRelease, missionActive, orphanedMission } from "./recovery";
import type { LocalState } from "./local";

const base: LocalState = {
  safetyState: "NORMAL", batteryPct: 80, zone: "kitchen", availability: "available", executor: true,
  missionPhase: "COMPLETED", activeTask: "task-a", hold: false, world: "house", waypoints: ["kitchen"],
};
const known = (id: string) => id === "task-a";

test("mission phases: driving/dwelling/capturing are active; finished ones are not", () => {
  for (const p of ["NAVIGATING", "DWELLING", "CAPTURING"]) assert.equal(missionActive({ missionPhase: p }), true, p);
  for (const p of ["IDLE", "COMPLETED", "CANCELED", "FAILED", "REJECTED", "ABORTED_SAFETY", ""]) assert.equal(missionActive({ missionPhase: p }), false, p);
});

test("restart: a mission still running for one of this robot's tasks is orphaned and must be cancelled", () => {
  // what happened on 2026-11-06: robot-master restarted while ROS was still driving task-a to the kitchen
  assert.equal(orphanedMission({ ...base, missionPhase: "NAVIGATING" }, known), "task-a");
});

test("restart: nothing to cancel when the mission finished, ROS is unreachable, or the mission is not ours", () => {
  assert.equal(orphanedMission(base, known), null);
  assert.equal(orphanedMission(null, known), null);
  assert.equal(orphanedMission({ ...base, missionPhase: "NAVIGATING", activeTask: "task-by-hand" }, known), null); // an operator's own mission
  assert.equal(orphanedMission({ ...base, missionPhase: "NAVIGATING", activeTask: null }, known), null);
});

test("release hold: allowed only when held, idle and not in an emergency stop", () => {
  const held = { ...base, hold: true, safetyState: "STOPPING", availability: "busy" };
  assert.deepEqual(decideRelease(held, false), { ok: true });
});

test("release hold: refused for an emergency stop, a running task or mission, no hold, or no state", () => {
  const held = { ...base, hold: true, safetyState: "STOPPING" };
  const refused = (s: LocalState | null, running: boolean, re: RegExp) => {
    const d = decideRelease(s, running);
    assert.equal(d.ok, false);
    if (!d.ok) assert.match(d.reason, re);
  };
  refused({ ...held, safetyState: "E_STOP" }, false, /emergency stop needs the operator/);
  refused({ ...held, safetyState: "RECOVERY_REQUIRED" }, false, /emergency stop needs the operator/);
  refused(held, true, /a task is running/);
  refused({ ...held, missionPhase: "NAVIGATING" }, false, /a mission is running/);
  refused(base, false, /not held/);
  refused(null, false, /cannot see its own state/);
});
