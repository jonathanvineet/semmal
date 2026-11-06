import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress, sha256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalFacts, detectHardware, identityMessage } from "@semmal/contracts";
import { answer } from "./identity";

const acct = privateKeyToAccount(generatePrivateKey());
const signer = { address: acct.address, signIdentity: (d: { hardwareModel: string; factsHash: string; nonce: string; issuedAt: string }) => acct.signMessage({ message: identityMessage({ wallet: acct.address, ...d }) }) };
const facts = { model: "create3", runtime: "gazebo", body: "cleaner", description: "0123456789abcdef", sensors: "camera,gpu_lidar,imu", world: "house", rosDistro: "jazzy", os: "Ubuntu 24.04.2 LTS", machine: "aaaaaaaaaaaaaaaa" };
const NONCE = "AbCdEf0123456789xyz";

test("a fresh identity is signed by the device key over the facts' hash and the nonce", async () => {
  const r = await answer({ facts, updatedAt: Date.now() / 1000 }, NONCE, signer);
  assert.ok(r.ok);
  if (!r.ok) return;
  const id = r.identity;
  assert.equal(id.factsHash, sha256(toHex(canonicalFacts(facts))));
  assert.equal(await recoverMessageAddress({ message: identityMessage(id), signature: id.signature as `0x${string}` }), acct.address);
  assert.deepEqual(detectHardware(id.facts), { ok: true, model: "create3", runtime: "gazebo" });
});

test("no answer when the robot stack is not running or the nonce is bad", async () => {
  assert.equal((await answer(null, NONCE, signer)).ok, false);
  const stale = await answer({ facts, updatedAt: Date.now() / 1000 - 60 }, NONCE, signer);
  assert.ok(!stale.ok && stale.code === 503);
  const bad = await answer({ facts, updatedAt: Date.now() / 1000 }, "short", signer);
  assert.ok(!bad.ok && bad.code === 400);
});

test("the platform's check: wrong body, missing sensors, unknown model, real hardware not yet accepted", () => {
  assert.match((detectHardware({ ...facts, body: "rover" }) as { reason: string }).reason, /not the iRobot Create 3 body/);
  assert.match((detectHardware({ ...facts, sensors: "imu" }) as { reason: string }).reason, /lacks camera, gpu_lidar/);
  assert.match((detectHardware({ ...facts, model: "roomba" }) as { reason: string }).reason, /not a supported robot/);
  assert.match((detectHardware({ ...facts, runtime: "hardware" }) as { reason: string }).reason, /not tested yet/);
  assert.deepEqual(detectHardware({ ...facts, model: "jackal", body: "field" }), { ok: true, model: "jackal", runtime: "gazebo" });
});
