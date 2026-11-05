import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { agentFixtures } from "./fixtures";
import { AgentListing, RobotProfile, VisionInspectionOutput } from "@semmal/contracts";
import { robotFixtures } from "./fixtures";
import { ZeroGRouter } from "@semmal/zerog-pc-adapter";

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
  return buildApp({ config: loadConfig({ OPERATOR_TOKEN: "op-secret-123", ...env }), registry: failingRegistry as any, router: unconfiguredRouter as any });
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
  const res = await app().inject({ method: "POST", url: "/api/zerog/probe", headers: { authorization: "Bearer op-secret-123" } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, "not_configured");
  assert.equal(res.json().providerRequestId, undefined);
});

test("vision output schema rejects unsupported actions", () => {
  assert.equal(VisionInspectionOutput.safeParse({ observation: "panel", anomaly_detected: true, anomaly_type: null, confidence: 0.9, recommended_action: "set_motor_pwm" }).success, false);
});
