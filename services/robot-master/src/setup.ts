/**
 * Setup for one robot on this PC: `pnpm run setup <name>` (also started by `pnpm start <name>` when the
 * robot is new). Saves to ~/.semmal/robots/<name>/ (owner-only).
 *
 * First run: asks for everything. Later runs show the saved settings and ask only for the ones you pick:
 *   pnpm run setup house              # menu: pick what to change (Enter = nothing)
 *   pnpm run setup house --token      # just paste a new link token
 *   pnpm run setup house --platform --token
 *   pnpm run setup house --all        # walk through every question again
 * Fields: --hardware --base --platform --arkiv --token. Secrets are typed with hidden input and never
 * printed or taken from the command line (that would leave them in shell history).
 * `pnpm setup` (without `run`) is pnpm's own command, not this script.
 */
import { existsSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { HARDWARE, robotIdFromWallet } from "@semmal/contracts";
import { generateDeviceKey } from "./device";
import { paths, readEnv, writeEnv } from "./profile";

const REPO = join(import.meta.dirname, "..", "..", "..");
const DEFAULT_API_PORT = 3001;
const mask = (v: string) => (v ? `set, ends …${v.slice(-4)}` : "not set");

export const FIELDS = ["hardware", "base", "platform", "arkiv", "token"] as const;
export type Field = (typeof FIELDS)[number];

/** Remove what terminals add around pasted text (bracketed-paste markers, control chars) and whitespace. */
export function cleanPasted(s: string) {
  return s.replace(/\x1b\[20[01]~/g, "").replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, "");
}

/** http(s)://host[:port] with no path; adds the API's default port when none is given. */
export function normalisePlatform(input: string): { url: string; addedPort: boolean } | null {
  const v = input.trim().replace(/\/+$/, "");
  const m = /^(https?):\/\/([^\s/:]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/.exec(v);
  if (!m) return null;
  if (m[3] !== undefined) {
    const port = Number(m[3]);
    return port >= 1 && port <= 65535 ? { url: v, addedPort: false } : null;
  }
  // https without a port is a tunnel or proxy on 443 (ngrok, VS Code dev tunnels): keep it as given
  if (m[1] === "https") return { url: v, addedPort: false };
  return { url: `${m[1]}://${m[2]}:${DEFAULT_API_PORT}`, addedPort: true };
}

/** Which settings to ask for, from command-line flags. null = no flags given. */
export function parseFieldFlags(args: string[]): { all: boolean; fields: Field[] } | null {
  if (!args.length) return null;
  const fields: Field[] = [];
  let all = false;
  for (const a of args) {
    if (a === "--all") all = true;
    else if (FIELDS.includes(a.replace(/^--/, "") as Field) && a.startsWith("--")) fields.push(a.slice(2) as Field);
    else throw new Error(`unknown option ${a}; use ${["--all", ...FIELDS.map((f) => `--${f}`)].join(" ")}`);
  }
  return { all, fields: [...new Set(fields)] };
}

/** A link token as the API issues it (apps/api/src/gateway.ts): `slk_` + base64url of 32 random bytes. */
export function isLinkToken(s: string) {
  return /^slk_[A-Za-z0-9_-]{20,96}$/.test(s);
}

/** True when a saved profile has everything the robot needs to start (the link token can come later). */
export function profileComplete(cur: Record<string, string>, keyExists: boolean) {
  return keyExists && Boolean(cur.SEMMAL_HARDWARE && cur.SEMMAL_BASE_LAT && cur.SEMMAL_BASE_LON && cur.SEMMAL_PLATFORM_URL);
}

export async function runSetup(name: string, args: string[] = []) {
  const p = paths(name);
  const cur = readEnv(p.env);
  const flags = parseFieldFlags(args);
  const tty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  // answers arrive as lines; queue them so piped input works as well as typing
  const lines: string[] = [];
  const waiting: ((l: string) => void)[] = [];
  rl.on("line", (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)));
  rl.on("close", () => waiting.splice(0).forEach((w) => w("")));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = rl as any;
  const ask = async (q: string, hidden = false) => {
    process.stdout.write(q);
    const write = r._writeToOutput;
    if (hidden && tty) r._writeToOutput = (s: string) => process.stdout.write(s.includes("\n") || s.includes("\r") ? "\n" : "*".repeat(s.length));
    else if (tty) r._writeToOutput = (s: string) => process.stdout.write(s);
    const line = lines.length ? lines.shift()! : await new Promise<string>((ok) => waiting.push(ok));
    r._writeToOutput = write;
    if (!tty) process.stdout.write("\n");
    return line.trim();
  };

  let address: string | undefined;
  if (existsSync(p.key)) {
    const { identitySigner } = await import("./device");
    address = identitySigner(p.key).address;
  }

  // Current values; each step below overwrites only its own.
  let hw = cur.SEMMAL_HARDWARE ?? "";
  let base = cur.SEMMAL_BASE_LAT && cur.SEMMAL_BASE_LON ? `${cur.SEMMAL_BASE_LAT}, ${cur.SEMMAL_BASE_LON}` : "";
  let radius = cur.SEMMAL_SERVICE_RADIUS_KM ?? "15";
  let platform = cur.SEMMAL_PLATFORM_URL ?? "";
  let arkiv = cur.ARKIV_ACCESS_KEY ?? "";
  let token = cur.SEMMAL_LINK_TOKEN ?? "";
  const hwName = (id: string) => HARDWARE.find((h) => h.id === id)?.name ?? (id || "not set");

  // ---- decide what to ask
  const firstRun = !profileComplete(cur, Boolean(address));
  let todo: Field[];
  if (firstRun || flags?.all) {
    todo = [...FIELDS];
    console.log(`\nSetting up robot "${name}" (saved in ${p.dir}, owner-only). Enter keeps the value in [brackets].\n`);
  } else if (flags?.fields.length) {
    todo = flags.fields;
    console.log(`\nRobot "${name}": changing ${todo.join(", ")}. Enter keeps the value in [brackets].`);
  } else {
    const summary: [Field, string, string][] = [
      ["hardware", "Hardware", hwName(hw)],
      ["base", "Base location", `${base} (travels up to ${radius} km)`],
      ["platform", "Platform", platform],
      ["arkiv", "Arkiv access key", mask(arkiv)],
      ["token", "Link token", mask(token)],
    ];
    console.log(`\nRobot "${name}" (${p.dir}), wallet ${address}:`);
    summary.forEach(([, label, value], i) => console.log(`  ${i + 1}. ${label.padEnd(17)} ${value}`));
    todo = [];
    for (;;) {
      const a = await ask(`Change which? Numbers, e.g. "3 5" (Enter = nothing): `);
      const picks = a.split(/[\s,]+/).filter(Boolean);
      const bad = picks.filter((x) => !/^[1-5]$/.test(x));
      if (bad.length) { console.log("  Use numbers 1-5 from the list."); continue; }
      todo = [...new Set(picks.map((x) => summary[Number(x) - 1]![0]))];
      break;
    }
    if (!todo.length) {
      rl.close();
      console.log("Nothing changed.");
      return { address: address!, robotId: cur.SEMMAL_ROBOT_ID ?? robotIdFromWallet(address!), hardware: hw };
    }
  }

  // ---- hardware
  if (todo.includes("hardware")) {
    const ids = HARDWARE.map((h) => h.id);
    HARDWARE.forEach((h, i) => console.log(`  ${i + 1}. ${h.name} (${h.maker}): ${h.note}`));
    for (;;) {
      const a = await ask(`Which hardware is this robot? 1-${ids.length}${hw ? ` [${hw}]` : ""}: `);
      if (!a && hw) break;
      const pick = ids[Number(a) - 1] ?? (ids.includes(a as never) ? a : "");
      if (pick) { hw = pick; break; }
      console.log("  Pick a number from the list.");
    }
  }

  // ---- wallet (device key): created once, never replaced
  if (address) {
    if (firstRun || flags?.all) console.log(`\nRobot wallet: ${address} (kept; a robot's key is never replaced here, because its records on Arkiv are signed with it)`);
  } else {
    console.log("\nThe robot's own wallet. Its key stays in this folder and signs the robot's evidence and payments.");
    for (;;) {
      const a = (await ask("  [g] generate a new wallet, or [i] import a private key you created: ")).toLowerCase();
      if (a === "g") {
        address = generateDeviceKey(p.key);
        break;
      }
      if (a === "i") {
        const pk = cleanPasted(await ask("  Private key (0x + 64 hex, hidden): ", true));
        if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
          console.log(`  That is not a private key: expected 0x followed by 64 hex characters, got ${pk.length} characters${pk.startsWith("0x") ? "" : " without the 0x prefix"}.`);
          continue;
        }
        mkdirSync(p.dir, { recursive: true, mode: 0o700 });
        writeFileSync(p.key, pk + "\n", { mode: 0o600 });
        chmodSync(p.key, 0o600);
        address = privateKeyToAccount(pk as `0x${string}`).address;
        break;
      }
      if (/^(0x)?[0-9a-fA-F]{64}$/.test(cleanPasted(a)))
        console.log("  That looks like a private key typed at the wrong prompt, and it was shown on screen. Do not use it: choose g for a new wallet.");
    }
    console.log(`  Robot wallet: ${address}`);
  }

  // ---- base location (exact here, on this PC; only a ~1 km version is ever published)
  if (todo.includes("base")) {
    console.log("\nWhere is the robot based? Latitude, longitude (e.g. from a map app: 13.0827, 80.2707). Customers see it only to about 1 km.");
    for (;;) {
      const a = (await ask(`Base location${base ? ` [${base}]` : ""}: `)) || base;
      const [lat, lon] = a.split(",").map((x) => Number(x.trim()));
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat!) <= 90 && Math.abs(lon!) <= 180 && a.includes(",")) { base = `${lat}, ${lon}`; break; }
      console.log("  Use the form latitude, longitude.");
    }
    for (;;) {
      const a = (await ask(`How far will it travel for a job, in km [${radius}]: `)) || radius;
      if (Number(a) >= 1 && Number(a) <= 500) { radius = String(Number(a)); break; }
      console.log("  A number from 1 to 500.");
    }
  }

  // ---- platform
  if (todo.includes("platform")) {
    console.log("\nPlatform address: the machine running the SEMMAL API. The robot connects out to it for its live link and agent jobs.");
    for (;;) {
      const a = await ask(`Platform address, e.g. http://10.0.0.5:${DEFAULT_API_PORT}${platform ? ` [${platform}]` : ""}: `);
      const n = normalisePlatform(a || platform);
      if (n) {
        platform = n.url;
        if (n.addedPort) console.log(`  No port given; using ${platform} (the API's default port).`);
        break;
      }
      console.log(`  Use the form http://<ip>:<port>, e.g. http://10.0.0.5:${DEFAULT_API_PORT}.`);
    }
  }

  // ---- secrets
  if (todo.includes("arkiv")) {
    arkiv = cleanPasted(await ask(`\nArkiv access key (optional, hidden; empty = public rate-limited endpoint) [${mask(arkiv)}]: `, true)) || arkiv;
  }
  if (todo.includes("token")) {
    if (firstRun) console.log("\nLink token: from the dashboard (Your robots -> Link robot) after you register this robot. Leave empty for now if not registered yet.");
    for (;;) {
      const a = cleanPasted(await ask(`${firstRun ? "" : "\n"}Link token (hidden) [${mask(token)}]: `, true));
      if (!a) break; // keep the current one
      if (isLinkToken(a)) { token = a; break; }
      console.log(`  That is not a link token (${a.length} characters${a.startsWith("pnpm") ? ", and it looks like a command" : ""}). ` +
        "Link tokens start with slk_ and are about 47 characters: copy it from the dashboard, Your robots -> Link robot. Enter keeps the current one.");
    }
  }
  rl.close();

  const robotId = robotIdFromWallet(address!);
  writeEnv(
    p.env,
    {
      ...cur,
      SEMMAL_HARDWARE: hw,
      SEMMAL_BASE_LAT: base.split(",")[0]!.trim(),
      SEMMAL_BASE_LON: base.split(",")[1]!.trim(),
      SEMMAL_SERVICE_RADIUS_KM: radius,
      SEMMAL_ROBOT_ID: robotId,
      SEMMAL_PLATFORM_URL: platform,
      SEMMAL_GATEWAY_URL: `${platform.replace(/^http/, "ws")}/api/gateway`,
      SEMMAL_LOCAL_API: cur.SEMMAL_LOCAL_API ?? "http://127.0.0.1:8765",
      SEMMAL_DATA_DIR: cur.SEMMAL_DATA_DIR ?? join(REPO, "data"),
      ARKIV_ACCESS_KEY: arkiv,
      SEMMAL_LINK_TOKEN: token,
    },
    `# SEMMAL robot "${name}". Owner-only. Edit with: pnpm run setup ${name}`,
  );
  console.log(`\nSaved. Robot "${name}": ${hwName(hw)}, wallet ${address}, robot id ${robotId}.`);
  if (!firstRun) {
    if (todo.includes("platform")) console.log(`Restart pnpm start ${name} to use the new platform address (a new link token is picked up live).`);
  } else
    console.log(token ? `Next: scripts/robot/scenario.sh ${name}  and  pnpm start ${name}` : `Next:
  1. Fund ${address} with 0G (https://faucet.0g.ai) and tGLM (https://hub.arkiv.network/faucet).
  2. Start it: scripts/robot/scenario.sh ${name}   (terminal 1)   and   pnpm start ${name}   (terminal 2).
  3. Register it at /robots/new: connect to this PC's IP; the wallet and hardware are read from the robot.
  4. Link it in the dashboard, then paste the token with: pnpm run setup ${name} --token`);
  return { address: address!, robotId, hardware: hw };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [name, ...args] = process.argv.slice(2);
  if (!name || name.startsWith("-")) {
    console.error(`usage: pnpm run setup <robot name> [--all | ${FIELDS.map((f) => `--${f}`).join(" ")}], e.g. pnpm run setup house --token`);
    process.exit(2);
  }
  runSetup(name, args).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
