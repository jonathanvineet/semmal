import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyMessage } from "viem";
import { RobotProfileSchema } from "@semmal/arkiv-adapter";
import { Device, defaultFeeCapWei, generateDeviceKey } from "./device";

const make = () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-"));
  const keyPath = join(dir, "robot-key");
  const address = generateDeviceKey(keyPath);
  const device = new Device({ keyPath, dataDir: join(dir, "data"), arkivAccessKey: "", maxArkivFeeWei: defaultFeeCapWei, maxArkivWritesPerDay: 2, storageRpc: "http://127.0.0.1:1", storageIndexer: "http://127.0.0.1:1", maxUploadsPerDay: 1, payRpc: "http://127.0.0.1:9", maxPaymentWei: 10n ** 17n, maxPaidWeiPerDay: 10n ** 18n, maxPaymentFeeWei: 10n ** 15n });
  return { keyPath, address, device };
};

test("the device key is owner-only and never overwritten", () => {
  const { keyPath, address } = make();
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.throws(() => generateDeviceKey(keyPath), /refusing to overwrite/);
});

test("manifest hashes are signed by the robot's own address (EIP-191)", async () => {
  const { device } = make();
  const sig = await device.signManifestHash("sha256:abc");
  assert.equal(await verifyMessage({ address: device.address, message: "sha256:abc", signature: sig }), true);
});

test("the key cannot write anything but the robot's evidence schemas", async () => {
  const { device } = make();
  await assert.rejects(device.arkivCreate("x", { schema: RobotProfileSchema, values: {}, options: {} }), /schema not allowed/);
});
