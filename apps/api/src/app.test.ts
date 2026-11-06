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
const unconfiguredRouter = new ZeroGRouter({ baseUrl: "", managementKey: "", apiKey: "", defaultModel: "m", requiredTrustMode: "private", timeoutMs: 1000 });

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

test("quote: no agents on Arkiv means an inspection is declined, not invented", async () => {
  const res = await app().inject({
    method: "POST", url: "/api/quote",
    payload: { preview: { robotType: "diff-drive-indoor", policy: { token: "0G", minFee: "5", maxQuote: "40", marginPct: 25, maxSpendPerTask: "10" } },
      plan: { skill: "warehouse.inspection", waypoints: 3, distanceM: 120, privacy: "private" } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "declined");
});

test("quote: a delivery needs no specialist and is priced inside the policy", async () => {
  const res = await app().inject({
    method: "POST", url: "/api/quote",
    payload: { preview: { robotType: "diff-drive-indoor", policy: { token: "0G", minFee: "2", maxQuote: "40", marginPct: 20, maxSpendPerTask: "10" } },
      plan: { skill: "indoor.delivery", waypoints: 1, distanceM: 60, privacy: "private" } },
  });
  // no agents means no 0G calls: operating time + margin, raised to the owner's minimum fee
  assert.equal(res.json().status, "ok");
  assert.equal(res.json().quote, "2.00");
  assert.ok(!res.json().lines.some((l: { source: string }) => l.source === "0g-router"));
});

test("two wallets can be signed in at once, one per tab (session header), each sees only itself", async () => {
  const { createSiweMessage } = await import("viem/siwe");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const { NotificationStore } = await import("./notifications");
  const admin = new AdminStore(join(mkdtempSync(join(tmpdir(), "semmal-")), "admin.json"));
  const notes = new NotificationStore(join(mkdtempSync(join(tmpdir(), "semmal-")), "n.db"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = buildApp({ config: loadConfig({}), registry: failingRegistry as any, router: unconfiguredRouter as any, admin, auth: new WalletAuth("localhost:3000"), notes });
  const signIn = async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const { nonce } = (await a.inject({ method: "GET", url: "/api/auth/nonce" })).json();
    const message = createSiweMessage({ address: acct.address, chainId: 7794095, domain: "localhost:3000", uri: "http://localhost:3000", version: "1", nonce });
    const r = await a.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await acct.signMessage({ message }) } });
    assert.equal(r.statusCode, 200);
    return { address: acct.address, sid: r.json().sid as string };
  };
  const one = await signIn();
  const two = await signIn();
  notes.add({ wallet: one.address, taskId: "task-abc123", kind: "request", title: "for one", body: "x", to: "owner" });
  const me = async (sid: string) => (await a.inject({ method: "GET", url: "/api/auth/me", headers: { "x-semmal-session": sid } })).json().address;
  assert.equal(await me(one.sid), one.address);
  assert.equal(await me(two.sid), two.address);
  const list = async (sid: string) => (await a.inject({ method: "GET", url: "/api/notifications", headers: { "x-semmal-session": sid } })).json().items.length;
  assert.equal(await list(one.sid), 1);
  assert.equal(await list(two.sid), 0);
  await a.inject({ method: "POST", url: "/api/auth/logout", headers: { "x-semmal-session": two.sid } });
  assert.equal(await me(two.sid), null);
  assert.equal(await me(one.sid), one.address, "signing one tab out leaves the other signed in");
});

test("orders are only for the signed-in wallet", async () => {
  const r = await app().inject({ method: "GET", url: "/api/orders" });
  assert.equal(r.statusCode, 401);
});
