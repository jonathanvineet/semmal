/**
 * Robot gateway: the live link between a robot host and the platform.
 *
 * - A robot authenticates with a link token its owner created in the dashboard (Authorization:
 *   Bearer slk_...). Only a sha256 of the token is stored; it is shown once and can be revoked.
 *   It is a revocable credential, not a wallet key.
 * - Every message is schema-checked and numbered; a sequence number that does not increase is a
 *   replay and is rejected. Messages are capped at 16 KiB.
 * - One live session per robot; a new connection replaces the old one. No heartbeat for 15 s
 *   means offline.
 * - Live state is in memory here (PostgreSQL/Redis in a later phase). Coarse data only: battery,
 *   safety state, a zone name, availability. Never coordinates.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WebSocket } from "ws";
import type { TaskEvent, TripMeta } from "./notifications";
import { RobotToPlatform, type PlatformToRobot } from "@semmal/contracts";

const HEARTBEAT_S = 5;
const OFFLINE_AFTER_MS = 15_000;
const HELLO_WITHIN_MS = 5_000;
export const MAX_MESSAGE_BYTES = 16 * 1024;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Link = { robotId: string; ownerWallet: string; tokenHash: string; createdAt: string; lastUsedAt?: string };

/** Link tokens, hashed, in data/robot-links.json (git-ignored). */
export class LinkStore {
  private links: Link[];
  constructor(private path: string) {
    this.links = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  }
  /** A new token for this robot; any older token for it stops working. Returned once. */
  issue(robotId: string, ownerWallet: string) {
    const token = `slk_${randomBytes(32).toString("base64url")}`;
    this.links = this.links.filter((l) => l.robotId !== robotId);
    this.links.push({ robotId, ownerWallet: ownerWallet.toLowerCase(), tokenHash: sha(token), createdAt: new Date().toISOString() });
    this.save();
    return token;
  }
  revoke(robotId: string) {
    const before = this.links.length;
    this.links = this.links.filter((l) => l.robotId !== robotId);
    this.save();
    return before !== this.links.length;
  }
  /** The robot a token belongs to, comparing hashes in constant time. */
  verify(token: string | undefined): Link | null {
    if (!token || !token.startsWith("slk_") || token.length > 100) return null;
    const h = Buffer.from(sha(token), "hex");
    const hit = this.links.find((l) => timingSafeEqual(Buffer.from(l.tokenHash, "hex"), h));
    if (hit) {
      hit.lastUsedAt = new Date().toISOString();
      this.save();
    }
    return hit ?? null;
  }
  has(robotId: string) {
    return this.links.some((l) => l.robotId === robotId);
  }
  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.links, null, 2));
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}

export type Trip = {
  robotId: string;
  site?: { lat: number; lon: number };
  startAt?: string;
  meta: TripMeta;
  points: { at: string; lat: number; lon: number; phase: string; etaAt?: string; remainingM?: number }[];
  offer?: { quoteId: string; amount: string; validUntil: string; robotWallet: string };
  /** The latest state the robot reported for this task, and when. */
  state?: { state: string; detail?: string; at: string };
  /** Every 0G decision the robot reported, in full (no image or prompt bytes). */
  decisions: Record<string, unknown>[];
};

export type LiveRobot = {
  robotId: string;
  online: boolean;
  sessionId?: string;
  softwareVersion?: string;
  connectedAt?: string;
  lastSeen?: string;
  batteryPct?: number;
  safetyState?: string;
  zone?: string;
  availability?: string;
  events: { at: string; kind: string; detail: string }[];
};

type Session = { id: string; socket: WebSocket; robotId: string; lastSeq: number; hello: boolean; lastBeat: number };

export class Gateway {
  private live = new Map<string, LiveRobot>();
  /** Live travel per task (positions, the customer's site). In memory only, never on Arkiv. */
  readonly trips = new Map<string, Trip>();
  /** The trip for a task this robot reports on; rebuilt from the robot's report if the platform restarted. */
  private tripFor(taskId: string, robotId: string): Trip | null {
    const t = this.trips.get(taskId);
    if (t) return t.robotId === robotId ? t : null;
    const fresh: Trip = { robotId, meta: { taskId, robotId, robotName: robotId }, points: [], decisions: [] };
    this.trips.set(taskId, fresh);
    return fresh;
  }
  /** Called for every task event the robot reports, with who is involved (for notifications). */
  onTaskEvent?: (meta: TripMeta, e: TaskEvent) => void;
  private emit(taskId: string | undefined, robotId: string, e: TaskEvent) {
    const t = taskId ? this.trips.get(taskId) : [...this.trips.values()].reverse().find((x) => x.robotId === robotId);
    if (!t || t.robotId !== robotId) return;
    try {
      this.onTaskEvent?.(t.meta, e);
    } catch {
      /* notifications never break the robot link */
    }
  }
  private sessions = new Map<string, Session>();
  private sweeper: NodeJS.Timeout;

  constructor(readonly links: LinkStore, private log: (msg: string, data?: Record<string, unknown>) => void = () => {}) {
    this.sweeper = setInterval(() => this.sweep(), 2_000);
    this.sweeper.unref();
  }

  stop() {
    clearInterval(this.sweeper);
    for (const s of this.sessions.values()) s.socket.close(1001, "server stopping");
  }

  private state(robotId: string): LiveRobot {
    let r = this.live.get(robotId);
    if (!r) {
      r = { robotId, online: false, events: [] };
      this.live.set(robotId, r);
    }
    return r;
  }

  private event(robotId: string, kind: string, detail: string) {
    const r = this.state(robotId);
    r.events = [{ at: new Date().toISOString(), kind, detail }, ...r.events].slice(0, 30);
  }

  private send(s: Session, msg: PlatformToRobot) {
    if (s.socket.readyState === 1) s.socket.send(JSON.stringify(msg));
  }

  /** Called after the HTTP upgrade was authenticated (the token matched `robotId`). */
  attach(socket: WebSocket, robotId: string) {
    const old = this.sessions.get(robotId);
    if (old) {
      this.send(old, { type: "error", code: "replaced", message: "A newer connection for this robot took over" });
      old.socket.close(4001, "replaced");
    }
    const s: Session = { id: randomUUID(), socket, robotId, lastSeq: 0, hello: false, lastBeat: Date.now() };
    this.sessions.set(robotId, s);
    const helloTimer = setTimeout(() => {
      if (!s.hello) socket.close(4002, "no hello");
    }, HELLO_WITHIN_MS);
    helloTimer.unref();

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > MAX_MESSAGE_BYTES) return socket.close(1009, "message too big or binary");
      let body: unknown;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        return this.send(s, { type: "error", code: "bad_json", message: "Messages must be JSON" });
      }
      const parsed = RobotToPlatform.safeParse(body);
      if (!parsed.success) return this.send(s, { type: "error", code: "bad_message", message: parsed.error.issues[0]?.message ?? "invalid" });
      const m = parsed.data;
      if (m.seq <= s.lastSeq) return this.send(s, { type: "error", code: "replay", message: `seq ${m.seq} is not after ${s.lastSeq}`, seq: m.seq });
      if (!s.hello && m.type !== "hello") return this.send(s, { type: "error", code: "hello_first", message: "Send hello first", seq: m.seq });
      s.lastSeq = m.seq;
      s.lastBeat = Date.now();
      const r = this.state(robotId);
      r.lastSeen = new Date().toISOString();

      switch (m.type) {
        case "hello":
          if (m.robotId !== robotId) {
            this.send(s, { type: "error", code: "wrong_robot", message: "This token belongs to another robot" });
            return socket.close(4003, "wrong robot");
          }
          s.hello = true;
          clearTimeout(helloTimer);
          Object.assign(r, { online: true, sessionId: s.id, softwareVersion: m.softwareVersion, connectedAt: new Date().toISOString() });
          this.event(robotId, "online", `connected, software ${m.softwareVersion}`);
          this.log("robot online", { robotId });
          return this.send(s, { type: "welcome", sessionId: s.id, serverTime: new Date().toISOString(), heartbeatSeconds: HEARTBEAT_S });
        case "heartbeat":
          if (r.safetyState !== m.safetyState) this.event(robotId, "safety", `${r.safetyState ?? "unknown"} → ${m.safetyState}`);
          Object.assign(r, { batteryPct: m.batteryPct, safetyState: m.safetyState, zone: m.zone, availability: m.availability });
          break;
        case "mission_progress": {
          const t = this.tripFor(m.taskId, robotId);
          if (t) t.state = { state: m.state, detail: m.detail, at: m.ts };
          this.event(robotId, "mission", `${m.taskId}: ${m.state}${m.detail ? ` · ${m.detail}` : ""}`);
          this.emit(m.taskId, robotId, { kind: "progress", state: m.state, detail: m.detail });
          break;
        }
        case "decision": {
          const t = this.tripFor(m.taskId, robotId);
          if (!t) break;
          t.decisions.push(m.detail);
          if (t.decisions.length > 50) t.decisions.splice(0, t.decisions.length - 50);
          break;
        }
        case "incident_notice":
          this.event(robotId, "incident", `${m.faultCode} (${m.severity}) · ${m.safetyAction} · ${m.persistence}`);
          this.emit(undefined, robotId, { kind: "incident", faultCode: m.faultCode, safetyAction: m.safetyAction });
          break;
        case "position": {
          const t = this.tripFor(m.taskId, robotId);
          if (!t) break; // another robot's task
          const prev = t.points.at(-1);
          t.points.push({ at: m.ts, lat: m.lat, lon: m.lon, phase: m.phase, etaAt: m.etaAt, remainingM: m.remainingM });
          if (t.points.length > 500) t.points.splice(0, t.points.length - 500);
          if (m.phase !== prev?.phase) this.event(robotId, "mission", `${m.taskId}: ${m.phase}${m.etaAt ? ` · ETA ${m.etaAt.slice(11, 16)}` : ""}`);
          this.emit(m.taskId, robotId, { kind: "position", phase: m.phase, remainingM: m.remainingM, etaAt: m.etaAt });
          break;
        }
        case "offer": {
          const t = this.tripFor(m.taskId, robotId);
          if (!t) break;
          t.offer = { quoteId: m.quoteId, amount: m.amount, validUntil: m.validUntil, robotWallet: m.payTo };
          this.event(robotId, "task", `${m.taskId}: offer ${m.amount} 0G`);
          break;
        }
        case "task_ack":
          this.event(robotId, "task", `${m.taskId} ${m.accepted ? "accepted" : `declined${m.reason ? `: ${m.reason}` : ""}`}`);
          this.emit(m.taskId, robotId, { kind: "ack", accepted: m.accepted, reason: m.reason });
          break;
      }
      this.send(s, { type: "ack", seq: m.seq });
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (this.sessions.get(robotId) === s) {
        this.sessions.delete(robotId);
        const r = this.state(robotId);
        if (r.online) this.event(robotId, "offline", "disconnected");
        Object.assign(r, { online: false, availability: "offline", sessionId: undefined });
      }
    });
  }

  private sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.hello && now - s.lastBeat > OFFLINE_AFTER_MS) {
        this.event(s.robotId, "offline", "no heartbeat for 15 s");
        s.socket.close(4004, "heartbeat timeout");
      }
    }
  }

  disconnect(robotId: string) {
    this.sessions.get(robotId)?.socket.close(4005, "link revoked");
  }

  /** Public, coarse view: who is online and available. */
  publicView() {
    return [...this.live.values()].map((r) => ({
      robotId: r.robotId,
      online: r.online,
      lastSeen: r.lastSeen,
      availability: r.online ? (r.availability ?? "available") : "offline",
      safetyState: r.online ? r.safetyState : undefined,
    }));
  }

  /** Owner view: everything the robot reported, plus the event log. */
  ownerView(robotId: string): LiveRobot & { linked: boolean } {
    return { ...this.state(robotId), linked: this.links.has(robotId) };
  }

  /** Progress the robot reported for one task (task acks, mission states, incidents during it). */
  taskEvents(robotId: string, taskId: string) {
    return this.state(robotId).events.filter((e) => e.detail.includes(taskId));
  }

  /** Pass the owner's decision on a booking to the robot (the caller has checked it is the owner). */
  ownerDecision(robotId: string, taskId: string, approved: boolean, reason?: string) {
    const s = this.sessions.get(robotId);
    if (!s?.hello) return { ok: false as const, reason: "The robot is not connected" };
    this.send(s, { type: "owner_decision", taskId, approved, ...(reason ? { reason } : {}) });
    this.event(robotId, "task", `${taskId}: owner ${approved ? "approved" : "declined"}`);
    return { ok: true as const };
  }

  /** Pass the customer's arrival confirmation to the robot (the caller has checked it is the customer). */
  confirmArrival(robotId: string, taskId: string) {
    const s = this.sessions.get(robotId);
    if (!s?.hello) return { ok: false as const, reason: "The robot is not connected" };
    this.send(s, { type: "arrival_confirmed", taskId });
    this.event(robotId, "task", `${taskId}: customer confirmed arrival`);
    return { ok: true as const };
  }

  /** Tell the robot a customer says they paid. The robot checks the transfer on chain itself. */
  paymentNotice(robotId: string, taskId: string, txHash: string) {
    const s = this.sessions.get(robotId);
    if (!s?.hello) return { ok: false as const, reason: "The robot is not connected" };
    this.send(s, { type: "payment_notice", taskId, txHash });
    this.event(robotId, "task", `${taskId} payment sent by the customer: ${txHash.slice(0, 12)}…`);
    return { ok: true as const };
  }

  /** Send a task to a connected robot. The robot validates it and answers with task_ack. */
  assign(robotId: string, task: Omit<Extract<PlatformToRobot, { type: "task_assignment" }>, "type" | "assignedAt" | "taskId"> & { taskId?: string }, who: { robotName?: string; ownerWallet?: string } = {}) {
    const s = this.sessions.get(robotId);
    if (!s?.hello) return { ok: false as const, reason: "The robot is not connected" };
    const r = this.state(robotId);
    if (r.safetyState && r.safetyState !== "NORMAL") return { ok: false as const, reason: `The robot reports ${r.safetyState}; tasks wait until it is NORMAL` };
    const taskId = task.taskId ?? `task-${randomUUID().slice(0, 12)}`;
    this.send(s, { ...task, type: "task_assignment", taskId, assignedAt: new Date().toISOString() });
    const meta: TripMeta = { taskId, robotId, robotName: who.robotName ?? robotId, ownerWallet: who.ownerWallet, customerWallet: task.customerWallet, skill: task.skill, startAt: task.startAt };
    this.trips.set(taskId, { robotId, site: task.site, startAt: task.startAt, meta, points: [], decisions: [] });
    try {
      this.onTaskEvent?.(meta, { kind: "dispatched" });
    } catch {
      /* never block a dispatch */
    }
    this.event(robotId, "task", `${taskId} sent: ${task.skill}, ${task.plan.waypoints} stops`);
    return { ok: true as const, taskId };
  }
}
