/**
 * Decisions robot-master makes about the robot's local state outside a running task:
 *  - on restart: is a ROS mission still running for a task this process abandoned?
 *  - on the owner's "release hold": may the soft hold be lifted?
 * Pure functions over the ROS gateway's state, so they are testable without ROS.
 */
import type { LocalState } from "./local";

/** Mission phases from mission_executor that mean "not driving" (semmal_gateway core.availability). */
const IDLE_PHASES = new Set(["", "IDLE", "COMPLETED", "CANCELED", "FAILED", "REJECTED", "ABORTED_SAFETY"]);

export const missionActive = (s: Pick<LocalState, "missionPhase">) => !IDLE_PHASES.has(s.missionPhase ?? "");

/**
 * A mission left running by a previous robot-master process: ROS is still executing it, and the task is
 * one this robot-master started (so a mission an operator started by hand is never touched).
 */
export function orphanedMission(s: LocalState | null, knownTask: (taskId: string) => boolean): string | null {
  if (!s || !s.activeTask || !missionActive(s)) return null;
  return knownTask(s.activeTask) ? s.activeTask : null;
}

export type ReleaseDecision = { ok: true } | { ok: false; reason: string };

/** Lift a soft hold only when nothing else is in play. Never touches an emergency stop. */
export function decideRelease(s: LocalState | null, taskRunning: boolean): ReleaseDecision {
  if (!s) return { ok: false, reason: "the robot cannot see its own state (ROS gateway unreachable)" };
  if (s.safetyState === "E_STOP" || s.safetyState === "RECOVERY_REQUIRED")
    return { ok: false, reason: `safety is ${s.safetyState}: an emergency stop needs the operator at the robot, not a hold release` };
  if (taskRunning) return { ok: false, reason: "a task is running; it decides when the robot moves" };
  if (missionActive(s)) return { ok: false, reason: `a mission is running (${s.missionPhase})` };
  if (!s.hold) return { ok: false, reason: `the robot is not held (safety ${s.safetyState})` };
  return { ok: true };
}
