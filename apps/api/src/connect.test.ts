import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalFacts, identityMessage } from "@semmal/contracts";
import { connectRobot, privateHost } from "./connect";

const acct = privateKeyToAccount(generatePrivateKey());
const facts = { model: "turtlebot4", runtime: "gazebo", body: "rover", description: "0123456789abcdef", sensors: "camera,gpu_lidar,imu", rosDistro: "jazzy" };

/** A stand-in robot: answers the challenge it is sent, optionally tampering with the answer. */
function robot(tamper: (d: Record<string, unknown>) => Record<string, unknown> = (d) => d) {
  return (async (url: string) => {
    const nonce = new URL(url).searchParams.get("nonce")!;
    const factsHash = sha256(toHex(canonicalFacts(facts)));
    const issuedAt = new Date().toISOString();
    const signature = await acct.signMessage({ message: identityMessage({ wallet: acct.address, hardwareModel: "turtlebot4", factsHash, nonce, issuedAt }) });
    const body = tamper({ schema: "semmal-robot-identity-v1", wallet: acct.address, hardwareModel: "turtlebot4", facts, factsHash, nonce, issuedAt, signature });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

test("only private network addresses can be reached", () => {
  for (const h of ["10.71.81.125", "192.168.1.4", "172.20.0.2", "127.0.0.1", "localhost"]) assert.ok(privateHost(h), h);
  for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "169.254.169.254", "10.0.0.1.evil"]) assert.ok(!privateHost(h), h);
});

test("a robot that holds its wallet key and runs supported hardware is verified", async () => {
  const r = await connectRobot("10.0.0.7", 8770, robot());
  assert.ok(r.ok && r.verified);
  if (!r.ok) return;
  assert.equal(r.identity.wallet, acct.address);
  assert.deepEqual(r.hardware, { ok: true, model: "turtlebot4", runtime: "gazebo" });
  assert.equal(r.robotId, `rbt-${acct.address.slice(2, 12).toLowerCase()}`);
});

test("a replayed, edited or wrongly signed answer is not verified", async () => {
  const replay = await connectRobot("10.0.0.7", 8770, robot((d) => ({ ...d, nonce: "OldNonceFromBefore123" })));
  assert.ok(replay.ok && !replay.verified && !replay.checks.nonce);
  const edited = await connectRobot("10.0.0.7", 8770, robot((d) => ({ ...d, facts: { ...facts, model: "jackal", body: "field" } })));
  assert.ok(edited.ok && !edited.verified && !edited.checks.factsHash);
  const other = privateKeyToAccount(generatePrivateKey());
  const stolen = await connectRobot("10.0.0.7", 8770, robot((d) => ({ ...d, wallet: other.address })));
  assert.ok(stolen.ok && !stolen.verified && !stolen.checks.signature);
});

test("an unreachable robot or a public address gives a plain error", async () => {
  const down = await connectRobot("10.0.0.7", 8770, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  assert.ok(!down.ok && /could not reach/.test(down.error));
  assert.ok(!(await connectRobot("8.8.8.8", 8770, robot())).ok);
});
