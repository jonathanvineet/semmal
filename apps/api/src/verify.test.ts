import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyEpisode } from "./verify";

// test-only key: proves the verifier accepts a real signature and rejects tampering
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

async function bundle(over: Record<string, unknown> = {}) {
  const acct = privateKeyToAccount(generatePrivateKey());
  const body = { schema: "semmal-episode-bundle-v1", robot_wallet: acct.address, episodeId: "ep-1", decisions: [{ providerRequestId: "req-1" }], ...over };
  const hash = `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`;
  const sig = await acct.signMessage({ message: hash });
  const text = canonical({ ...body, manifest_hash: hash, robot_signature: sig });
  return { acct, text, record: { manifestHash: `0x${hash.slice(7)}`, robotSignature: sig, robotWallet: acct.address } };
}

test("a genuine episode bundle verifies", async () => {
  const b = await bundle();
  const c = await verifyEpisode(b.text, b.record, b.acct.address);
  assert.deepEqual([c.manifestHash, c.signature, c.arkivLink], [true, true, true]);
});

test("edited content, a different robot or a mismatched record all fail", async () => {
  const b = await bundle();
  const edited = b.text.replace("req-1", "req-2");
  assert.equal((await verifyEpisode(edited, b.record, b.acct.address)).manifestHash, false);
  const other = privateKeyToAccount(generatePrivateKey()).address;
  assert.equal((await verifyEpisode(b.text, b.record, other)).signature, false);
  assert.equal((await verifyEpisode(b.text, { ...b.record, manifestHash: `0x${"0".repeat(64)}` }, b.acct.address)).arkivLink, false);
});
