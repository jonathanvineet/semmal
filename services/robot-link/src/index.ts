/**
 * robot-link: the robot host's connection to the SEMMAL gateway.
 *
 * It does not drive the robot and does not decide safety. It relays what the robot's own ROS 2
 * stack reports (via SEMMAL_STATE_FILE, written by the ROS gateway node) and passes tasks to it.
 * Without that state it says so: safety DEGRADED, tasks declined. It never claims a state it
 * cannot see. Battery falls back to the host machine's own battery reading.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import WebSocket from "ws";
import type { PlatformToRobot } from "@semmal/contracts";

const URL_ = process.env.SEMMAL_GATEWAY_URL ?? "ws://127.0.0.1:3001/api/gateway";
const ROBOT_ID = process.env.SEMMAL_ROBOT_ID ?? "";
const TOKEN = process.env.SEMMAL_LINK_TOKEN ?? "";
const STATE_FILE = process.env.SEMMAL_STATE_FILE ?? "/tmp/semmal-robot-state.json";
const VERSION = "robot-link/0.1.0";
if (!ROBOT_ID || !TOKEN) {
  console.error("Set SEMMAL_ROBOT_ID and SEMMAL_LINK_TOKEN (dashboard → Your robots → Link).");
  process.exit(1);
}

type RobotState = { safetyState: string; batteryPct: number; zone?: string; availability: string; executor: boolean; fresh: boolean };

function hostBattery(): number | null {
  try {
    if (process.platform === "darwin") {
      const m = execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }).match(/(\d+)%/);
      return m ? Number(m[1]) : null;
    }
    if (existsSync("/sys/class/power_supply/BAT0/capacity")) return Number(readFileSync("/sys/class/power_supply/BAT0/capacity", "utf8").trim());
  } catch {
    /* no battery reading */
  }
  return null;
}

/** State from the ROS gateway node if it wrote it in the last 10 s; otherwise an honest DEGRADED. */
function readState(): RobotState {
  try {
    if (existsSync(STATE_FILE) && Date.now() - statSync(STATE_FILE).mtimeMs < 10_000) {
      const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      return { safetyState: String(s.safetyState), batteryPct: Number(s.batteryPct), zone: s.zone, availability: String(s.availability ?? "available"), executor: Boolean(s.executor), fresh: true };
    }
  } catch {
    /* fall through */
  }
  return { safetyState: "DEGRADED", batteryPct: hostBattery() ?? 100, availability: "busy", executor: false, fresh: false };
}

let seq = 0;
let backoff = 1000;
const ts = () => new Date().toISOString();

function connect() {
  const ws = new WebSocket(URL_, { headers: { authorization: `Bearer ${TOKEN}` } });
  let beat: NodeJS.Timeout | undefined;
  const send = (m: Record<string, unknown>) => ws.readyState === 1 && ws.send(JSON.stringify({ ...m, seq: ++seq, ts: ts() }));

  ws.on("open", () => {
    backoff = 1000;
    send({ type: "hello", robotId: ROBOT_ID, softwareVersion: VERSION });
  });
  ws.on("unexpected-response", (_req, res) => {
    console.error(`Gateway refused the link (HTTP ${res.statusCode}). Check the token; it may have been replaced or revoked.`);
    process.exit(2);
  });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as PlatformToRobot;
    if (m.type === "welcome") {
      console.log(`Linked as ${ROBOT_ID} (session ${m.sessionId.slice(0, 8)}). Heartbeat every ${m.heartbeatSeconds}s.`);
      const tick = () => {
        const s = readState();
        if (!s.fresh) process.stdout.write("· no fresh state from the ROS gateway node: reporting DEGRADED\r");
        send({ type: "heartbeat", batteryPct: Math.max(0, Math.min(100, s.batteryPct)), safetyState: s.safetyState, zone: s.zone, availability: s.availability });
      };
      tick();
      beat = setInterval(tick, m.heartbeatSeconds * 1000);
    } else if (m.type === "task_assignment") {
      const s = readState();
      const ok = s.fresh && s.executor && s.safetyState === "NORMAL";
      console.log(`\nTask ${m.taskId}: ${m.skill}, ${m.plan.waypoints} stops → ${ok ? "accepted, handed to the mission executor" : "declined"}`);
      send({ type: "task_ack", taskId: m.taskId, accepted: ok, ...(ok ? {} : { reason: s.fresh ? `robot reports ${s.safetyState}${s.executor ? "" : ", no mission executor"}` : "No mission executor connected (ROS 2 gateway node not running)" }) });
    } else if (m.type === "error") {
      console.error(`\nGateway: ${m.code}: ${m.message}`);
    }
  });
  ws.on("close", (code) => {
    if (beat) clearInterval(beat);
    if (code === 4005) {
      console.error("\nThe owner revoked this robot's link.");
      process.exit(3);
    }
    console.error(`\nDisconnected (${code}). Reconnecting in ${Math.round(backoff / 1000)}s…`);
    setTimeout(connect, backoff);
    backoff = Math.min(30_000, backoff * 2);
  });
  ws.on("error", () => {
    /* close follows */
  });
}

connect();
