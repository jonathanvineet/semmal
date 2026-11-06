/**
 * First-run setup for one robot on this PC: `pnpm setup <name>` (also started by `pnpm start <name>`
 * when the robot is new). Asks in the terminal, saves to ~/.semmal/robots/<name>/ (owner-only).
 * Run it again any time to change a setting (Enter keeps the current value), e.g. to paste the link
 * token after registering. Secrets are typed with hidden input and never printed.
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
const mask = (v: string) => (v ? `set, ends …${v.slice(-4)}` : "not set");

export async function runSetup(name: string) {
  const p = paths(name);
  const cur = readEnv(p.env);
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

  console.log(`\nSetting up robot "${name}" (saved in ${p.dir}, owner-only). Enter keeps the value in [brackets].\n`);

  // 1. hardware
  const ids = HARDWARE.map((h) => h.id);
  HARDWARE.forEach((h, i) => console.log(`  ${i + 1}. ${h.name} (${h.maker}): ${h.note}`));
  let hw = cur.SEMMAL_HARDWARE ?? "";
  for (;;) {
    const a = await ask(`Which hardware is this robot? 1-${ids.length}${hw ? ` [${hw}]` : ""}: `);
    if (!a && hw) break;
    const pick = ids[Number(a) - 1] ?? (ids.includes(a as never) ? a : "");
    if (pick) { hw = pick; break; }
    console.log("  Pick a number from the list.");
  }

  // 2. wallet (device key)
  let address: string;
  if (existsSync(p.key)) {
    const { identitySigner } = await import("./device");
    address = identitySigner(p.key).address;
    console.log(`\nRobot wallet: ${address} (kept; a robot's key is never replaced here, because its records on Arkiv are signed with it)`);
  } else {
    console.log("\nThe robot's own wallet. Its key stays in this folder and signs the robot's evidence and payments.");
    for (;;) {
      const a = (await ask("  [g] generate a new wallet, or [i] import a private key you created: ")).toLowerCase();
      if (a === "g") {
        address = generateDeviceKey(p.key);
        break;
      }
      if (a === "i") {
        const pk = await ask("  Private key (0x + 64 hex, hidden): ", true);
        if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.log("  That is not a private key (0x followed by 64 hex characters)."); continue; }
        mkdirSync(p.dir, { recursive: true, mode: 0o700 });
        writeFileSync(p.key, pk + "\n", { mode: 0o600 });
        chmodSync(p.key, 0o600);
        address = privateKeyToAccount(pk as `0x${string}`).address;
        break;
      }
    }
    console.log(`  Robot wallet: ${address}`);
  }

  // 3. platform, Arkiv, link token
  let platform = cur.SEMMAL_PLATFORM_URL ?? "";
  for (;;) {
    const a = await ask(`\nPlatform address, the Mac running the API, e.g. http://10.0.0.5:3001${platform ? ` [${platform}]` : ""}: `);
    const v = (a || platform).replace(/\/$/, "");
    if (/^https?:\/\/[^\s/]+$/.test(v)) { platform = v; break; }
    console.log("  Use the form http://<ip>:<port>.");
  }
  const arkiv = (await ask(`Arkiv access key (hidden, from hub.arkiv.network) [${mask(cur.ARKIV_ACCESS_KEY ?? "")}]: `, true)) || cur.ARKIV_ACCESS_KEY || "";
  console.log("\nLink token: from the dashboard (Your robots -> Link robot) after you register this robot. Leave empty for now if not registered yet.");
  const token = (await ask(`Link token (hidden) [${mask(cur.SEMMAL_LINK_TOKEN ?? "")}]: `, true)) || cur.SEMMAL_LINK_TOKEN || "";
  if (token && !token.startsWith("slk_")) console.log("  Note: link tokens start with slk_. Saved anyway; run setup again to fix it.");
  rl.close();

  const robotId = robotIdFromWallet(address);
  writeEnv(
    p.env,
    {
      ...cur,
      SEMMAL_HARDWARE: hw,
      SEMMAL_ROBOT_ID: robotId,
      SEMMAL_PLATFORM_URL: platform,
      SEMMAL_GATEWAY_URL: `${platform.replace(/^http/, "ws")}/api/gateway`,
      SEMMAL_LOCAL_API: cur.SEMMAL_LOCAL_API ?? "http://127.0.0.1:8765",
      SEMMAL_DATA_DIR: cur.SEMMAL_DATA_DIR ?? join(REPO, "data"),
      ARKIV_ACCESS_KEY: arkiv,
      SEMMAL_LINK_TOKEN: token,
    },
    `# SEMMAL robot "${name}". Owner-only. Edit with: pnpm setup ${name}`,
  );
  const h = HARDWARE.find((x) => x.id === hw)!;
  console.log(`\nSaved. Robot "${name}": ${h.name}, wallet ${address}, robot id ${robotId}.`);
  console.log(token ? `Next: scripts/robot/scenario.sh ${name}  and  pnpm start ${name}` : `Next:
  1. Fund ${address} with 0G (https://faucet.0g.ai) and tGLM (https://hub.arkiv.network/faucet).
  2. Start it: scripts/robot/scenario.sh ${name}   (terminal 1)   and   pnpm start ${name}   (terminal 2).
  3. Register it at /robots/new: connect to this PC's IP; the wallet and hardware are read from the robot.
  4. Link it in the dashboard, then paste the token with: pnpm setup ${name}`);
  return { address, robotId, hardware: hw };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: pnpm setup <robot name>, e.g. pnpm setup house");
    process.exit(2);
  }
  runSetup(name).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
