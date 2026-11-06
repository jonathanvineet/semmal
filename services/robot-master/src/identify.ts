/**
 * Device identity service: lets the platform check which robot it is talking to. `pnpm start <name>`
 * runs it alongside the robot agent; `pnpm identify <name>` runs it alone.
 *
 *   GET /semmal/identity?nonce=<16-64 letters/digits>
 *   -> { schema, wallet, hardwareModel, facts, factsHash, nonce, issuedAt, signature }
 *
 * Facts come from the ROS identity node (semmal_identity), which writes them while the robot stack
 * runs. The answer is signed with the robot's device key over a fresh nonce from the platform, which
 * proves the machine you reached holds the robot wallet's key. The key never leaves this machine.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { identitySigner } from "./device";
import { answer, type IdentityFile } from "./identity";
import { loadProfile } from "./profile";

export function lanIps() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
}

export function serveIdentity(o: { keyPath: string; file: string; port: number; log: (m: string) => void }) {
  const signer = identitySigner(o.keyPath);
  const readFile = (): IdentityFile | null => {
    try {
      return JSON.parse(readFileSync(o.file, "utf8")) as IdentityFile;
    } catch {
      return null;
    }
  };
  let hits: number[] = [];
  const server = createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const u = new URL(req.url ?? "/", "http://robot");
    if (req.method !== "GET" || u.pathname !== "/semmal/identity") return send(404, { error: "not found" });
    const now = Date.now();
    hits = hits.filter((t) => now - t < 60_000);
    if (hits.push(now) > 30) return send(429, { error: "too many requests" });
    const r = await answer(readFile(), u.searchParams.get("nonce") ?? "", signer).catch((e) => ({ ok: false as const, code: 500, error: (e as Error).message }));
    if (!r.ok) {
      o.log(`identity requested: ${r.error}`);
      return send(r.code, { error: r.error });
    }
    o.log(`identity requested: answered as ${r.identity.hardwareModel} (${r.identity.facts.runtime ?? "?"})`);
    send(200, r.identity);
  });
  server.on("error", (e) => o.log(`identity service could not start on port ${o.port}: ${(e as Error).message} (is another robot running?)`));
  server.listen(o.port, "0.0.0.0", () => o.log(`identity service on port ${o.port}; register at /robots/new by connecting to ${lanIps().join(" or ") || "this PC's IP"}`));
  return server;
}

export const identityFile = () => process.env.SEMMAL_IDENTITY_FILE || join(process.env.SEMMAL_DATA_DIR || join(homedir(), ".semmal"), "robot", "identity.json");

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const name = process.argv[2];
  if (name && !loadProfile(name)) {
    console.error(`robot "${name}" is not set up yet: pnpm setup ${name}`);
    process.exit(2);
  }
  serveIdentity({
    keyPath: process.env.SEMMAL_ROBOT_KEY_FILE || join(homedir(), ".semmal", "robot-key"),
    file: identityFile(),
    port: Number(process.env.SEMMAL_IDENTITY_PORT || 8770),
    log: (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`),
  });
}
