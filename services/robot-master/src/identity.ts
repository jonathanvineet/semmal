/** Build a signed identity answer from the facts the ROS identity node wrote (pure apart from the signer). */
import { sha256, toHex } from "viem";
import { canonicalFacts, HardwareFacts, type RobotIdentity } from "@semmal/contracts";

export type IdentityFile = { facts: unknown; updatedAt: number };
export const STALE_AFTER_S = 10;

export async function answer(
  file: IdentityFile | null,
  nonce: string,
  signer: { address: `0x${string}`; signIdentity: (d: { hardwareModel: string; factsHash: string; nonce: string; issuedAt: string }) => Promise<`0x${string}`> },
  now = Date.now(),
): Promise<{ ok: true; identity: RobotIdentity } | { ok: false; code: number; error: string }> {
  if (!/^[A-Za-z0-9]{16,64}$/.test(nonce)) return { ok: false, code: 400, error: "nonce must be 16-64 letters or digits" };
  if (!file) return { ok: false, code: 503, error: "the robot stack is not running (no identity from the ROS identity node)" };
  if (now / 1000 - file.updatedAt > STALE_AFTER_S) return { ok: false, code: 503, error: "the robot stack stopped (the ROS identity node has not reported for over 10 s)" };
  const facts = HardwareFacts.safeParse(file.facts);
  if (!facts.success) return { ok: false, code: 500, error: "the identity node wrote facts in an unexpected format" };
  const factsHash = sha256(toHex(canonicalFacts(facts.data)));
  const hardwareModel = facts.data.model ?? "unknown";
  const issuedAt = new Date(now).toISOString();
  const signature = await signer.signIdentity({ hardwareModel, factsHash, nonce, issuedAt });
  return { ok: true, identity: { schema: "semmal-robot-identity-v1", wallet: signer.address, hardwareModel, facts: facts.data, factsHash, nonce, issuedAt, signature } };
}
