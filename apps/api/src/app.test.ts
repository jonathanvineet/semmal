import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { agentFixtures } from "./fixtures";
import { AgentListing, RobotProfile, VisionInspectionOutput } from "@semmal/contracts";
import { robotFixtures } from "./fixtures";
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
  config: { profileTtlDays: 30, trustedPublishers: [], accessKey: "" },
  publicClient: { request: async ({ method }: { method: string }) => (method === "eth_chainId" ? "0x76edaf" : null) },
};
const unconfiguredRouter = new ZeroGRouter({ baseUrl: "", apiKey: "", defaultModel: "m", requiredTrustMode: "private", timeoutMs: 1000 });

function app(env: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = new AdminStore(join(mkdtempSync(join(tmpdir(), "semmal-")), "admin.json"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildApp({ config: loadConfig({ ...env }), registry: failingRegistry as any, router: unconfiguredRouter as any, admin, auth: new WalletAuth("localhost:3000") });
}

test("fixtures satisfy the v1 contracts", () => {
  for (const r of robotFixtures()) RobotProfile.parse(r);
  for (const a of agentFixtures()) AgentListing.parse(a);
});

test("Arkiv outage: items are labelled SIMULATED, never ARKIV", async () => {
  const res = await app().inject({ method: "GET", url: "/api/agents" });
  const body = res.json();
  assert.equal(body.arkiv.ok, false);
  assert.ok(body.items.length > 0);
  assert.ok(body.items.every((i: { provenance: string }) => i.provenance === "SIMULATED"));
});

test("fixtures can be switched off: outage then shows nothing", async () => {
  const res = await app({ SHOW_SIMULATED_FIXTURES: "false" }).inject({ method: "GET", url: "/api/robots" });
  assert.deepEqual(res.json().items, []);
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
  for (const [method, url] of [["GET", "/api/admin/state"], ["POST", "/api/admin/roles"], ["POST", "/api/admin/claim"]] as const) {
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
