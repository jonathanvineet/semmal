/**
 * robot-master: the robot's own agent, running on the robot PC next to ROS 2.
 * Talks to ROS only through the local gateway node; to the platform through the gateway link and
 * the agent runner; signs its own evidence with its device key.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Device, defaultFeeCapWei } from "./device";
import { Evidence } from "./evidence";
import { Link } from "./link";
import { httpLocal } from "./local";
import { runTask } from "./mission";
import { httpPlatform } from "./platform";
import { TaskStore } from "./store";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") throw new Error(`Set ${k} in .env.robot`);
  return v;
};
const ROBOT_ID = env("SEMMAL_ROBOT_ID");
const DATA = env("SEMMAL_DATA_DIR", join(homedir(), ".semmal"));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const device = new Device({
  keyPath: env("SEMMAL_ROBOT_KEY_FILE", join(homedir(), ".semmal", "robot-key")),
  dataDir: join(DATA, "robot-master"),
  arkivAccessKey: process.env.ARKIV_ACCESS_KEY ?? "",
  maxArkivFeeWei: process.env.ROBOT_MAX_ARKIV_FEE_WEI ? BigInt(process.env.ROBOT_MAX_ARKIV_FEE_WEI) : defaultFeeCapWei,
  maxArkivWritesPerDay: Number(process.env.ROBOT_MAX_ARKIV_WRITES_PER_DAY ?? 200),
  storageRpc: env("ZEROG_STORAGE_RPC_URL", "https://evmrpc-testnet.0g.ai"),
  storageIndexer: env("ZEROG_STORAGE_INDEXER_URL", "https://indexer-storage-testnet-turbo.0g.ai"),
  maxUploadsPerDay: Number(process.env.ROBOT_MAX_UPLOADS_PER_DAY ?? 100),
});
const local = httpLocal(env("SEMMAL_LOCAL_API", "http://127.0.0.1:8765"));
const platform = httpPlatform(env("SEMMAL_PLATFORM_URL", "http://127.0.0.1:3001"), env("SEMMAL_LINK_TOKEN"));
const store = new TaskStore(join(DATA, "robot-master"));

let link: Link;
const evidence = new Evidence(device, ROBOT_ID, join(DATA, "robot-master"), env("SEMMAL_INCIDENT_SPOOL", join(DATA, "robot", "incident_spool.db")), log, (kind, id, stage, extra) => {
  log(`${kind} ${id}: ${stage}${extra?.root ? ` root ${extra.root.slice(0, 12)}…` : ""}`);
  if (kind === "incident")
    link?.send({ type: "incident_notice", incidentId: id.slice(0, 64), faultCode: (extra?.faultCode ?? "UNKNOWN").slice(0, 60), severity: (extra?.severity as "critical") ?? "critical", safetyAction: "EMERGENCY_STOP", persistence: stage });
});

let busy = false;
link = new Link(env("SEMMAL_GATEWAY_URL", "ws://127.0.0.1:3001/api/gateway"), ROBOT_ID, env("SEMMAL_LINK_TOKEN"), "robot-master/0.1.0", {
  log,
  heartbeat: async () => {
    try {
      const s = await local.state();
      return { batteryPct: s.batteryPct, safetyState: s.safetyState, zone: s.zone, availability: busy ? "busy" : s.availability };
    } catch {
      // ROS gateway unreachable: say so, never claim a safety state we cannot see
      return { batteryPct: 0, safetyState: "DEGRADED", availability: "offline" };
    }
  },
  onTask: (m) => {
    if (busy) return link.send({ type: "task_ack", taskId: m.taskId, accepted: false, reason: "robot is already on a task" });
    busy = true;
    log(`task ${m.taskId}: ${m.skill}, ${m.plan.waypoints} stops`);
    runTask(m, {
      robotId: ROBOT_ID,
      robotWallet: device.address,
      local,
      platform,
      evidence,
      store,
      progress: (state, taskId, detail) => link.send({ type: "mission_progress", taskId, state, detail: detail?.slice(0, 200) }),
      ack: (taskId, accepted, reason) => link.send({ type: "task_ack", taskId, accepted, ...(reason ? { reason: reason.slice(0, 200) } : {}) }),
    })
      .then((ep) => ep && log(`task ${m.taskId} finished: ${ep.outcome}, ${ep.decisions.length} decision(s)`))
      .catch((e) => log(`task ${m.taskId} error: ${(e as Error).message}`))
      .finally(() => (busy = false));
  },
});

const recovered = store.recover();
if (recovered.length) log(`marked ${recovered.length} unfinished task(s) SAFE_STOP after restart`);
log(`robot ${ROBOT_ID}, device wallet ${device.address}`);
evidence.start();
link.start();
