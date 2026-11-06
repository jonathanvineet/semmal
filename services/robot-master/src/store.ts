/** Task state machine persistence (CLAUDE.md 6.1). Every transition is kept with time and reason. */
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const TASK_STATES = [
  "TASK_RECEIVED", "AWAITING_PAYMENT", "PAID", "TRAVELLING", "ARRIVED", "VALIDATING", "PLANNING", "DISCOVERING_SPECIALISTS", "HIRING_SPECIALISTS", "EXECUTING",
  "VERIFYING", "COMPLETED", "FAILED", "ABORTED", "PAUSED", "DEGRADED", "INCIDENT", "WAITING_FOR_0G", "SAFE_STOP",
] as const;
export type TaskState = (typeof TASK_STATES)[number];
const FINAL: TaskState[] = ["COMPLETED", "FAILED", "ABORTED", "SAFE_STOP"];

export class TaskStore {
  private db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(`${dir}/robot-master.db`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (task_id TEXT PRIMARY KEY, state TEXT NOT NULL, assignment TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transitions (task_id TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL);`);
  }
  /** False if this task was seen before: a re-delivered assignment is never run twice. */
  begin(taskId: string, assignment: unknown) {
    const now = new Date().toISOString();
    const r = this.db.prepare("INSERT OR IGNORE INTO tasks (task_id, state, assignment, created_at, updated_at) VALUES (?, 'TASK_RECEIVED', ?, ?, ?)").run(taskId, JSON.stringify(assignment), now, now);
    if (r.changes === 0) return false;
    this.log(taskId, "TASK_RECEIVED", "assignment received", "gateway");
    return true;
  }
  move(taskId: string, state: TaskState, reason: string, actor = "robot-master") {
    this.db.prepare("UPDATE tasks SET state = ?, updated_at = ? WHERE task_id = ?").run(state, new Date().toISOString(), taskId);
    this.log(taskId, state, reason, actor);
  }
  private log(taskId: string, state: string, reason: string, actor: string) {
    this.db.prepare("INSERT INTO transitions (task_id, at, state, reason, actor) VALUES (?, ?, ?, ?, ?)").run(taskId, new Date().toISOString(), state, reason, actor);
  }
  history(taskId: string) {
    return this.db.prepare("SELECT at, state, reason, actor FROM transitions WHERE task_id = ? ORDER BY rowid").all(taskId) as { at: string; state: string; reason: string; actor: string }[];
  }
  /** On restart: tasks left mid-flight are not resumed blindly; they are marked SAFE_STOP. */
  recover() {
    const open = this.db.prepare(`SELECT task_id FROM tasks WHERE state NOT IN (${FINAL.map(() => "?").join(",")})`).all(...FINAL) as { task_id: string }[];
    for (const t of open) this.move(t.task_id, "SAFE_STOP", "robot-master restarted mid-task; not resumed without a new assignment", "recovery");
    return open.map((t) => t.task_id);
  }
}
