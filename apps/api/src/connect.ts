/**
 * Connect to a robot on the local network and check who it is (registration).
 *
 * The platform sends a fresh nonce to the robot's device identity service and checks the answer:
 * the signature recovers the robot wallet (so that machine holds the wallet's key), the nonce and
 * time are fresh (not a replay), the facts hash matches the facts, and the facts describe supported
 * hardware (detectHardware, run here, not on the robot). Facts are reported by the robot's own
 * software: they show what it runs, they are not a hardware attestation (no TPM yet).
 *
 * Only private network addresses are reachable, so this cannot be pointed at the internet.
 */
import { randomBytes } from "node:crypto";
import { isIPv4 } from "node:net";
import { recoverMessageAddress, sha256, toHex } from "viem";
import { canonicalFacts, detectHardware, identityMessage, robotIdFromWallet, RobotIdentity, type HardwareCheck } from "@semmal/contracts";

export function privateHost(host: string) {
  if (host === "localhost") return true;
  if (!isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export type ConnectResult =
  | { ok: false; error: string }
  | {
      ok: true;
      verified: boolean;
      identity: RobotIdentity;
      robotId: string;
      hardware: HardwareCheck;
      checks: { signature: boolean; nonce: boolean; fresh: boolean; factsHash: boolean; modelMatches: boolean };
    };

export async function connectRobot(host: string, port: number, fetcher: typeof fetch = fetch, now = Date.now()): Promise<ConnectResult> {
  if (!privateHost(host)) return { ok: false, error: "use the robot's address on your local network (10.x, 172.16-31.x, 192.168.x or localhost)" };
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: "port must be 1024-65535" };
  const nonce = randomBytes(18).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 24).padEnd(16, "x");
  let text: string;
  try {
    const r = await fetcher(`http://${host}:${port}/semmal/identity?nonce=${nonce}`, { signal: AbortSignal.timeout(6000), redirect: "error" });
    text = await r.text();
    if (text.length > 32_000) return { ok: false, error: "the robot's answer is too large" };
    if (!r.ok) return { ok: false, error: `the robot answered ${r.status}: ${(JSON.parse(text) as { error?: string }).error ?? "error"}` };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.name === "TimeoutError" ? "the robot did not answer within 6 s" : "could not reach the robot's identity service there (is pnpm start <name> running on it?)" };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "the robot's answer is not JSON" };
  }
  const p = RobotIdentity.safeParse(body);
  if (!p.success) return { ok: false, error: "the robot's answer is not a SEMMAL identity" };
  const id = p.data;
  const recovered = await recoverMessageAddress({ message: identityMessage(id), signature: id.signature as `0x${string}` }).catch(() => null);
  const checks = {
    signature: Boolean(recovered && recovered.toLowerCase() === id.wallet.toLowerCase()),
    nonce: id.nonce === nonce,
    fresh: Math.abs(Date.parse(id.issuedAt) - now) < 120_000,
    factsHash: id.factsHash === sha256(toHex(canonicalFacts(id.facts))),
    modelMatches: id.hardwareModel === (id.facts.model ?? "unknown"),
  };
  const hardware = detectHardware(id.facts);
  return { ok: true, verified: Object.values(checks).every(Boolean) && hardware.ok, identity: id, robotId: robotIdFromWallet(id.wallet), hardware, checks };
}
