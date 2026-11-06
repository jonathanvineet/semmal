/**
 * robot-master: the robot's own agent, running on the robot PC next to ROS 2.
 * Talks to ROS only through the local gateway node; to the platform through the gateway link and
 * the agent runner; signs its own evidence with its device key.
 *
 *   pnpm start <name>   first run: asks for everything (setup.ts) and saves it; later runs use it.
 *                       Always serves the device identity (for registration); links to the platform
 *                       once a link token is saved (pnpm run setup <name> --token to paste it; picked up live).
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
import { toWei } from "@semmal/quote";

import { identityFile, serveIdentity } from "./identify";
import { loadProfile, paths, readEnv } from "./profile";
import { runSetup } from "./setup";
import { decideRelease, orphanedMission } from "./recovery";

// One robot PC can host several robots (one at a time): pnpm start house
const NAME = process.argv[2] || process.env.SEMMAL_ROBOT_NAME;
if (NAME) {
  if (!loadProfile(NAME)) {
    if (!process.stdin.isTTY) {
      console.error(`robot "${NAME}" is not set up yet; run it once in a terminal: pnpm start ${NAME}`);
      process.exit(2);
    }
    await runSetup(NAME);
    loadProfile(NAME);
  }
} else if (process.env.SEMMAL_ENV_FILE) process.loadEnvFile(process.env.SEMMAL_ENV_FILE); // older single-file setups

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") throw new Error(`Set ${k} in .env.robot`);
  return v;
};
const ROBOT_ID = env("SEMMAL_ROBOT_ID");
const DATA = env("SEMMAL_DATA_DIR", join(homedir(), ".semmal"));
// each robot keeps its own task store and evidence queue, so robots never sign each other's records
const OWN = join(DATA, "robot-master", ROBOT_ID);
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// registration needs this before the robot is linked, so it always runs
serveIdentity({ keyPath: env("SEMMAL_ROBOT_KEY_FILE", join(homedir(), ".semmal", "robot-key")), file: identityFile(), port: Number(process.env.SEMMAL_IDENTITY_PORT || 8770), log });

const device = new Device({
  keyPath: env("SEMMAL_ROBOT_KEY_FILE", join(homedir(), ".semmal", "robot-key")),
  dataDir: OWN,
  arkivAccessKey: process.env.ARKIV_ACCESS_KEY ?? "",
  maxArkivFeeWei: process.env.ROBOT_MAX_ARKIV_FEE_WEI ? BigInt(process.env.ROBOT_MAX_ARKIV_FEE_WEI) : defaultFeeCapWei,
  maxArkivWritesPerDay: Number(process.env.ROBOT_MAX_ARKIV_WRITES_PER_DAY ?? 200),
  storageRpc: env("ZEROG_STORAGE_RPC_URL", "https://evmrpc-testnet.0g.ai"),
  storageIndexer: env("ZEROG_STORAGE_INDEXER_URL", "https://indexer-storage-testnet-turbo.0g.ai"),
  maxUploadsPerDay: Number(process.env.ROBOT_MAX_UPLOADS_PER_DAY ?? 100),
  payRpc: env("ZEROG_PAY_RPC_URL", "https://evmrpc-testnet.0g.ai"),
  maxPaymentWei: toWei(env("ROBOT_MAX_PAYMENT_0G", "0.15")),
  maxPaidWeiPerDay: toWei(env("ROBOT_MAX_PAID_PER_DAY_0G", "1")),
  maxPaymentFeeWei: toWei(env("ROBOT_MAX_PAYMENT_FEE_0G", "0.001")),
});
const local = httpLocal(env("SEMMAL_LOCAL_API", "http://127.0.0.1:8765"));

// not registered and linked yet: keep serving the identity, wait for the token to be saved
if (!process.env.SEMMAL_LINK_TOKEN) {
  log(`robot ${ROBOT_ID} (wallet ${device.address}) is not linked yet.`);
  log(`Register it at /robots/new, click Link robot in the dashboard, then paste the token here: pnpm run setup ${NAME ?? "<name>"} --token`);
  await new Promise<void>((ok) => {
    const t = setInterval(() => {
      const v = NAME ? readEnv(paths(NAME).env).SEMMAL_LINK_TOKEN : "";
      if (v) {
        process.env.SEMMAL_LINK_TOKEN = v;
        clearInterval(t);
        log("link token saved; linking to the platform");
        ok();
      }
    }, 5000);
  });
}
const platform = httpPlatform(env("SEMMAL_PLATFORM_URL", "http://127.0.0.1:3001"), env("SEMMAL_LINK_TOKEN"));
const store = new TaskStore(OWN);

let link: Link;
const evidence = new Evidence(device, ROBOT_ID, OWN, env("SEMMAL_INCIDENT_SPOOL", join(DATA, "robot", "incident_spool.db")), log, (kind, id, stage, extra) => {
  log(`${kind} ${id}: ${stage}${extra?.root ? ` root ${extra.root.slice(0, 12)}…` : ""}`);
  if (kind === "incident")
    link?.send({ type: "incident_notice", incidentId: id.slice(0, 64), faultCode: (extra?.faultCode ?? "UNKNOWN").slice(0, 60), severity: (extra?.severity as "critical") ?? "critical", safetyAction: "EMERGENCY_STOP", persistence: stage });
});

// payment notices from the platform: the robot checks each one on chain before trusting it
const payments = new Map<string, string[]>();
const payWaiters = new Map<string, (tx: string) => void>();
const awaitPayment = (taskId: string, waitMs: number) =>
  new Promise<string | null>((resolve) => {
    const queued = payments.get(taskId)?.shift();
    if (queued) return resolve(queued);
    const t = setTimeout(() => {
      payWaiters.delete(taskId);
      resolve(null);
    }, waitMs);
    payWaiters.set(taskId, (tx) => {
      clearTimeout(t);
      payWaiters.delete(taskId);
      resolve(tx);
    });
  });

// the owner's decision and the customer's arrival confirmation arrive the same way (one waiter per task)
const signals = new Map<string, unknown>();
const signalWaiters = new Map<string, (v: unknown) => void>();
const signal = (key: string, v: unknown) => {
  const w = signalWaiters.get(key);
  if (w) w(v);
  else signals.set(key, v);
};
const waitSignal = <T>(key: string, waitMs: number) =>
  new Promise<T | null>((resolve) => {
    if (signals.has(key)) {
      const v = signals.get(key) as T;
      signals.delete(key);
      return resolve(v);
    }
    const t = setTimeout(() => {
      signalWaiters.delete(key);
      resolve(null);
    }, waitMs);
    signalWaiters.set(key, (v) => {
      clearTimeout(t);
      signalWaiters.delete(key);
      resolve(v as T);
    });
  });

const fastForwarded = new Set<string>();

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
  onPayment: (taskId, txHash) => {
    log(`task ${taskId}: customer reports payment ${txHash.slice(0, 12)}…; checking on chain`);
    const w = payWaiters.get(taskId);
    if (w) w(txHash);
    else payments.set(taskId, [...(payments.get(taskId) ?? []).slice(-4), txHash]);
  },
  onOwnerDecision: (taskId, approved, reason) => {
    log(`task ${taskId}: the owner ${approved ? "approved" : "declined"} it`);
    signal(`owner:${taskId}`, { approved, reason });
  },
  onArrivalConfirmed: (taskId) => {
    log(`task ${taskId}: the customer confirmed the robot is on site`);
    signal(`arrival:${taskId}`, true);
  },
  onFastForward: (taskId) => {
    log(`task ${taskId}: fast-forwarding the trip`);
    fastForwarded.add(taskId);
  },
  onReleaseHold: (by) => {
    void (async () => {
      const answer = (released: boolean, reason: string) => {
        log(`owner ${by || "?"} asked to release the hold: ${released ? "released" : `refused, ${reason}`}`);
        link.send({ type: "hold_result", released, reason: reason.slice(0, 200) });
      };
      const d = decideRelease(await local.state().catch(() => null), busy);
      if (!d.ok) return answer(false, d.reason);
      if (busy) return answer(false, "a task started meanwhile; it decides when the robot moves");
      try {
        await local.hold(false);
      } catch {
        return answer(false, "could not reach the ROS gateway to release the hold");
      }
      await new Promise((r) => setTimeout(r, 500));
      const after = await local.state().catch(() => null);
      if (after && !after.hold) answer(true, `released by the owner; safety ${after.safetyState}`);
      else answer(false, "the hold did not clear on the robot");
    })();
  },
  onLinked: () => {
    // tasks abandoned by a restart: tell the platform how they ended (repeat on every reconnect; same state)
    for (const id of recovered) link.send({ type: "mission_progress", taskId: id, state: "SAFE_STOP", detail: "robot-master restarted mid-task; not resumed" });
  },
  onTask: (m) => {
    if (busy) return link.send({ type: "task_ack", taskId: m.taskId, accepted: false, reason: "robot is already on a task" });
    busy = true;
    log(`task ${m.taskId}: ${m.skill}, ${m.plan.waypoints} stops`);
    runTask(m, {
      robotId: ROBOT_ID,
      robotWallet: device.address,
      wallet: device,
      awaitPayment,
      ...(process.env.SEMMAL_BASE_LAT && process.env.SEMMAL_BASE_LON ? { base: { lat: Number(process.env.SEMMAL_BASE_LAT), lon: Number(process.env.SEMMAL_BASE_LON) } } : {}),
      position: (p) => link.send({ type: "position", ...p }),
      offer: (o) => link.send({ type: "offer", ...o }),
      awaitOwner: (taskId, ms) => waitSignal<{ approved: boolean; reason?: string }>(`owner:${taskId}`, ms),
      awaitArrival: async (taskId, ms) => (await waitSignal<boolean>(`arrival:${taskId}`, ms)) === true,
      decision: (detail) => link.send({ type: "decision", taskId: detail.taskId, detail }),
      log,
      travelSpeedup: Number(process.env.SEMMAL_TRAVEL_SPEEDUP || 1),
      fastForward: (taskId) => fastForwarded.has(taskId),
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

// ---- restart recovery: never resume blindly, never leave the robot driving for an abandoned task
const recovered = store.recover();
if (recovered.length) log(`marked ${recovered.length} unfinished task(s) SAFE_STOP after restart`);
{
  const orphan = orphanedMission(await local.state().catch(() => null), (id) => store.has(id));
  if (orphan) {
    try {
      await local.cancel();
      log(`cancelled the mission still running for ${orphan} (left by the previous run)`);
    } catch {
      log(`could not cancel the mission still running for ${orphan}: ROS gateway unreachable`);
    }
  }
}
log(`robot ${ROBOT_ID}, device wallet ${device.address}`);
device
  .balanceWei()
  .then((b) => log(`wallet balance on 0G Galileo: ${(Number(b) / 1e18).toFixed(6)} 0G`))
  .catch(() => log("could not read the wallet balance on 0G Galileo"));
evidence.start();
link.start();
