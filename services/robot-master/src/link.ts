/** The robot's WebSocket link to the platform gateway (authenticated with its link token). */
import WebSocket from "ws";
import type { PlatformToRobot } from "@semmal/contracts";

export type LinkHandlers = {
  heartbeat: () => Promise<Record<string, unknown>>;
  onTask: (m: Extract<PlatformToRobot, { type: "task_assignment" }>) => void;
  onPayment: (taskId: string, txHash: string) => void;
  onOwnerDecision: (taskId: string, approved: boolean, reason?: string) => void;
  onArrivalConfirmed: (taskId: string) => void;
  onFastForward: (taskId: string) => void;
  /** The owner asks to end a soft hold; the robot decides and answers with hold_result. */
  onReleaseHold: (requestedBy: string) => void;
  /** Called after every (re)connect, once the platform has welcomed the robot. */
  onLinked?: () => void;
  log: (msg: string) => void;
};

export class Link {
  private ws?: WebSocket;
  private seq = 0;
  private backoff = 1000;
  private beat?: NodeJS.Timeout;

  constructor(private url: string, private robotId: string, private token: string, private version: string, private h: LinkHandlers) {}

  start() {
    this.connect();
  }

  send(m: Record<string, unknown>) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ ...m, seq: ++this.seq, ts: new Date().toISOString() }));
  }

  private connect() {
    const ws = new WebSocket(this.url, { headers: { authorization: `Bearer ${this.token}` } });
    this.ws = ws;
    ws.on("open", () => {
      this.backoff = 1000;
      this.send({ type: "hello", robotId: this.robotId, softwareVersion: this.version });
    });
    ws.on("unexpected-response", (_q, res) => {
      this.h.log(`gateway refused the link (HTTP ${res.statusCode}); the token may be replaced or revoked`);
      process.exit(2);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as PlatformToRobot;
      if (m.type === "welcome") {
        this.h.log(`linked as ${this.robotId}; heartbeat every ${m.heartbeatSeconds}s`);
        const tick = async () => this.send({ type: "heartbeat", ...(await this.h.heartbeat()) });
        void tick();
        this.beat = setInterval(() => void tick(), m.heartbeatSeconds * 1000);
        this.h.onLinked?.();
      } else if (m.type === "task_assignment") this.h.onTask(m);
      else if (m.type === "payment_notice" && /^0x[0-9a-fA-F]{64}$/.test(m.txHash)) this.h.onPayment(m.taskId, m.txHash);
      else if (m.type === "owner_decision") this.h.onOwnerDecision(m.taskId, m.approved === true, m.reason);
      else if (m.type === "arrival_confirmed") this.h.onArrivalConfirmed(m.taskId);
      else if (m.type === "fast_forward") this.h.onFastForward(m.taskId);
      else if (m.type === "release_hold") this.h.onReleaseHold(String(m.requestedBy ?? "").slice(0, 64));
      else if (m.type === "error") this.h.log(`gateway: ${m.code}: ${m.message}`);
    });
    ws.on("close", (code) => {
      if (this.beat) clearInterval(this.beat);
      if (code === 4005) {
        this.h.log("the owner revoked this robot's link");
        process.exit(3);
      }
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(30_000, this.backoff * 2);
    });
    ws.on("error", () => undefined);
  }
}
