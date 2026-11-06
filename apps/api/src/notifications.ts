/**
 * Notifications for the robot's owner and for the customer who booked it, made from what the robot
 * reports (task ack, progress, position, incidents). Kept on the platform per wallet, read only by
 * that wallet's signed-in session. No addresses or locations in the text; each kind once per task.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROBOT_SKILLS } from "@semmal/contracts";

export type TripMeta = { taskId: string; robotId: string; robotName: string; ownerWallet?: string; customerWallet?: string; skill?: string; startAt?: string };
export type TaskEvent =
  | { kind: "dispatched" }
  | { kind: "ack"; accepted: boolean; reason?: string }
  | { kind: "progress"; state: string; detail?: string }
  | { kind: "position"; phase: string; remainingM?: number; etaAt?: string }
  | { kind: "incident"; faultCode: string; safetyAction: string };
export type Note = { wallet: string; taskId: string; kind: string; title: string; body: string; to: "owner" | "customer" };

const time = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 16) + " UTC" : "");
const skillName = (s?: string) => ROBOT_SKILLS.find((x) => x.id === s)?.label ?? s ?? "a job";

/** Who hears about what. Pure. */
export function notesFor(t: TripMeta, e: TaskEvent): Note[] {
  const out: Note[] = [];
  const owner = (kind: string, title: string, body: string) => t.ownerWallet && out.push({ wallet: t.ownerWallet.toLowerCase(), taskId: t.taskId, kind, title, body, to: "owner" });
  const customer = (kind: string, title: string, body: string) => t.customerWallet && out.push({ wallet: t.customerWallet.toLowerCase(), taskId: t.taskId, kind, title, body, to: "customer" });
  const r = t.robotName;
  switch (e.kind) {
    case "dispatched":
      owner("request", t.customerWallet ? "New booking" : "Test task sent", `${r}: ${skillName(t.skill)}${t.startAt ? `, on site ${time(t.startAt)}` : ""}.`);
      customer("request", "Booking sent", `${r} is working out its offer for ${skillName(t.skill)}.`);
      break;
    case "ack":
      if (!e.accepted) {
        owner("declined", `${r} declined a booking`, e.reason ?? "No reason given.");
        customer("declined", `${r} declined your booking`, e.reason ?? "No reason given.");
      }
      break;
    case "position":
      if (e.phase === "TRAVELLING" && (e.remainingM ?? Infinity) < 1500)
        customer("arriving", `${r} is almost there`, `About ${Math.max(1, Math.round((e.remainingM ?? 0) / 1000 * 2))} min away${e.etaAt ? `, arriving about ${time(e.etaAt)}` : ""}.`);
      if (e.phase === "ARRIVED") {
        customer("arrived", `${r} has arrived`, "It is at your site and starts at the booked time.");
        owner("arrived", `${r} arrived on site`, `For ${skillName(t.skill)}.`);
      }
      break;
    case "incident":
      owner(`incident-${e.faultCode}`, `${r} stopped: ${e.faultCode}`, `Safety action ${e.safetyAction}. It stays stopped until you approve recovery.`);
      customer(`incident-${e.faultCode}`, `${r} had to stop`, "It stopped safely. Anything it did not spend comes back to you.");
      break;
    case "progress": {
      const d = e.detail ?? "";
      switch (e.state) {
        case "AWAITING_PAYMENT": {
          const amount = /pay ([\d.]+) 0G/.exec(d)?.[1];
          customer("offer", `Offer from ${r}`, amount ? `Pay ${amount} 0G to confirm. The offer is valid for 5 minutes.` : "Its offer is ready to pay.");
          break;
        }
        case "PAID":
          if (/^received/.test(d)) {
            customer("paid", "Payment confirmed", `${r} checked your payment and is getting ready.`);
            owner("paid", "Booking paid", `${r}: ${d.split(";")[0]}.`);
          }
          break;
        case "TRAVELLING":
          customer("travelling", `${r} is on the way`, d ? `${d}.` : "It has set off.");
          owner("travelling", `${r} left for a job`, d ? `${d}.` : "");
          break;
        case "COMPLETED":
          customer("done", `${r} finished`, d ? `${d}.` : "The job is done.");
          owner("done", `${r} finished a job`, d ? `${d}.` : "");
          break;
        case "SAFE_STOP":
        case "FAILED":
          customer("ended", `${r} could not finish`, `${d || e.state}. Anything it did not spend comes back to you.`);
          owner("ended", `${r} could not finish a job`, d || e.state);
          break;
        case "ABORTED":
          if (/not paid/.test(d)) customer("expired", "Offer expired", `${r}'s offer was not paid in time. Book again for a new one.`);
          else {
            customer("ended", `${r} stopped the job`, d || "Aborted.");
            owner("ended", `${r} stopped a job`, d || "Aborted.");
          }
          break;
      }
    }
  }
  return out;
}

export class NotificationStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL, at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0,
      UNIQUE (wallet, task_id, kind))`);
    this.db.prepare("DELETE FROM notes WHERE at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
  }
  add(n: Note) {
    this.db
      .prepare("INSERT OR IGNORE INTO notes (wallet, task_id, kind, title, body, audience, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(n.wallet.toLowerCase(), n.taskId, n.kind, n.title.slice(0, 120), n.body.slice(0, 300), n.to, new Date().toISOString());
  }
  list(wallet: string, limit = 40) {
    const w = wallet.toLowerCase();
    const items = this.db.prepare("SELECT id, task_id AS taskId, kind, title, body, audience, at, read FROM notes WHERE wallet = ? ORDER BY id DESC LIMIT ?").all(w, limit) as {
      id: number; taskId: string; kind: string; title: string; body: string; audience: string; at: string; read: number;
    }[];
    const unread = (this.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE wallet = ? AND read = 0").get(w) as { n: number }).n;
    return { items: items.map((i) => ({ ...i, read: i.read === 1 })), unread };
  }
  markRead(wallet: string, ids?: number[]) {
    const w = wallet.toLowerCase();
    if (!ids) this.db.prepare("UPDATE notes SET read = 1 WHERE wallet = ?").run(w);
    else for (const id of ids.slice(0, 200)) this.db.prepare("UPDATE notes SET read = 1 WHERE wallet = ? AND id = ?").run(w, id);
  }
}
