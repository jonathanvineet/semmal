import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { agentFixtures } from "./fixtures";
import { AgentListing, RobotProfile, VisionInspectionOutput, robotIdFromWallet } from "@semmal/contracts";
import { ZeroGRouter } from "@semmal/zerog-pc-adapter";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdminStore, WalletAuth } from "./admin";

// Fakes only for unit tests; never used by the running server.
const failingRegistry = {
  status: async () => ({ reachable: false }),
  listRobots: async () => { throw new Error("rpc down"); },
  listAgents: async () => { throw new Error("rpc down"); },
  config: { profileTtlDays: 30, accessKey: "" },
  publicClient: { request: async ({ method }: { method: string }) => (method === "eth_chainId" ? "0x76edaf" : null) },
};
const unconfiguredRouter = new ZeroGRouter({ baseUrl: "", apiKey: "", defaultModel: "m", requiredTrustMode: "private", timeoutMs: 1000 });

function app(env: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = new AdminStore(join(mkdtempSync(join(tmpdir(), "semmal-")), "admin.json"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildApp({ config: loadConfig({ ...env }), registry: failingRegistry as any, router: unconfiguredRouter as any, admin, auth: new WalletAuth("localhost:3000") });
}

test("agent drafts satisfy the v1 contract", () => {
  for (const a of agentFixtures()) AgentListing.parse(a);
});

test("a robot profile needs a valid robot wallet and owner wallet", () => {
  const base = { schemaVersion: "1.0", robotId: robotIdFromWallet("0x00000000000000000000000000000000000000ab"), robotWallet: "0x00000000000000000000000000000000000000ab",
    ownerWallet: "0x00000000000000000000000000000000000000cd", displayName: "Rover 01", model: "semmal-rover-sim", robotType: "diff-drive-indoor",
    hardware: { base: "x", sensors: ["lidar-2d"] }, capabilities: ["warehouse.patrol"], rosInterfaceVersion: "0.1.0", profileVersion: 1,
    serviceArea: "warehouse-a", price: { amount: "12.50", token: "USDC", unit: "task" } };
  assert.equal(RobotProfile.safeParse(base).success, true);
  assert.equal(RobotProfile.safeParse({ ...base, robotWallet: "0x123" }).success, false);
  assert.equal(RobotProfile.safeParse({ ...base, capabilities: [] }).success, false);
  assert.equal(robotIdFromWallet("0xABCDEF0123456789000000000000000000000000"), "rbt-abcdef0123");
});

test("Arkiv outage: empty list and an error, nothing filled in", async () => {
  for (const url of ["/api/agents", "/api/robots"]) {
    const body = (await app().inject({ method: "GET", url })).json();
    assert.equal(body.arkiv.ok, false);
    assert.deepEqual(body.items, []);
  }
});

test("Arkiv RPC proxy forwards reads", async () => {
  const res = await app().inject({ method: "POST", url: "/api/arkiv/rpc", payload: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().result, "0x76edaf");
});

for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "eth_signTransaction"]) {
  test(`Arkiv RPC proxy refuses ${method}`, async () => {
    const res = await app().inject({ method: "POST", url: "/api/arkiv/rpc", payload: { jsonrpc: "2.0", id: 1, method, params: [] } });
    assert.equal(res.statusCode, 403);
  });
}

test("no server-side registry write route exists", async () => {
  const res = await app().inject({ method: "POST", url: "/api/registry/agents", payload: agentFixtures()[0] });
  assert.equal(res.statusCode, 404);
});

test("0G probe without configuration fails closed, no fabricated result", async () => {
  const res = await app().inject({ method: "POST", url: "/api/zerog/probe" });
  assert.equal(res.statusCode, 401); // admin wallet session required before any call
  assert.equal(res.json().providerRequestId, undefined);
});

test("vision output schema rejects unsupported actions", () => {
  assert.equal(VisionInspectionOutput.safeParse({ observation: "panel", anomaly_detected: true, anomaly_type: null, confidence: 0.9, recommended_action: "set_motor_pwm" }).success, false);
});

test("admin routes need a wallet session", async () => {
  const a = app();
  for (const [method, url] of [["GET", "/api/admin/state"], ["POST", "/api/admin/claim"]] as const) {
    const res = await a.inject({ method, url, payload: method === "POST" ? {} : undefined });
    assert.equal(res.statusCode, 401, url);
  }
});

test("forged session cookie is rejected", async () => {
  const res = await app().inject({ method: "GET", url: "/api/admin/state", headers: { cookie: "semmal_sid=not-a-session" } });
  assert.equal(res.statusCode, 401);
});

test("sign-in rejects an unknown nonce and junk signature", async () => {
  const a = app();
  const msg = "localhost:3000 wants you to sign in with your Ethereum account:\n0x0000000000000000000000000000000000000001\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: 7794095\nNonce: abcdefgh12345678\nIssued At: 2026-11-06T00:00:00.000Z";
  const res = await a.inject({ method: "POST", url: "/api/auth/verify", payload: { message: msg, signature: "0x1234" } });
  assert.equal(res.statusCode, 401);
});

test("me reports no owner on a fresh store", async () => {
  const res = await app().inject({ method: "GET", url: "/api/auth/me" });
  assert.deepEqual(res.json(), { address: null, role: "none", ownerSet: false });
});

test("ownership claim needs the one-time code; roles are enforced", () => {
  const store = new AdminStore(join(mkdtempSync(join(tmpdir(), "semmal-")), "admin.json"));
  const owner = "0x00000000000000000000000000000000000000aa";
  const other = "0x00000000000000000000000000000000000000bb";
  const code = store.bootstrapCode()!;
  assert.throws(() => store.claimOwnership(owner, "WRONG"));
  store.claimOwnership(owner, code);
  assert.equal(store.bootstrapCode(), null);
  assert.throws(() => store.claimOwnership(other, code));
  assert.throws(() => store.update(other, "add_publisher", other)); // not an admin
  store.update(owner, "add_admin", other);
  assert.throws(() => store.update(other, "add_admin", owner)); // admins cannot manage admins
  store.update(other, "add_publisher", "0x00000000000000000000000000000000000000cc");
  assert.equal(store.trustedPublishers().length, 3);
});
