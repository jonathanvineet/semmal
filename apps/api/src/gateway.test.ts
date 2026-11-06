import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { AdminStore, WalletAuth } from "./admin";
import { Gateway, LinkStore } from "./gateway";
import { ZeroGRouter } from "@semmal/zerog-pc-adapter";

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "semmal-gw-"));
  const gateway = new Gateway(new LinkStore(join(dir, "links.json")));
  const app = buildApp({
    config: loadConfig({}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry: { listRobots: async () => [], listAgents: async () => [], status: async () => ({}), config: { profileTtlDays: 30, accessKey: "" } } as any,
    router: new ZeroGRouter({ baseUrl: "", managementKey: "", apiKey: "", defaultModel: "", requiredTrustMode: "private", timeoutMs: 1000 }),
    admin: new AdminStore(join(dir, "admin.json")),
    auth: new WalletAuth("localhost:3000"),
    gateway,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  return { app, gateway, url: `ws://127.0.0.1:${port}/api/gateway` };
}

const now = () => new Date().toISOString();
function connect(url: string, token: string) {
  const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  const inbox: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => void)[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    const w = waiters.shift();
    if (w) w(m); else inbox.push(m);
  });
  const next = () => new Promise<Record<string, unknown>>((res) => { const m = inbox.shift(); if (m) res(m); else waiters.push(res); });
  const open = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.on("error", rej); });
  const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
  return { ws, next, open, closed, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test("a bad or revoked token is refused before the socket opens", async () => {
  const { app, url } = await start();
  await assert.rejects(connect(url, "slk_nope").open, /HTTP 401/);
  await app.close();
});

test("hello, heartbeat, live status, task delivery, replay rejection, disconnect", async () => {
  const { app, gateway, url } = await start();
  const token = gateway.links.issue("rbt-test-1", "0x00000000000000000000000000000000000000aa");
  const c = connect(url, token);
  await c.open;

  c.send({ type: "heartbeat", seq: 1, ts: now(), batteryPct: 90, safetyState: "NORMAL", availability: "available" });
  assert.equal((await c.next()).code, "hello_first");

  c.send({ type: "hello", seq: 2, ts: now(), robotId: "rbt-test-1", softwareVersion: "0.1.0" });
  assert.equal((await c.next()).type, "welcome");

  c.send({ type: "heartbeat", seq: 3, ts: now(), batteryPct: 87, safetyState: "NORMAL", zone: "aisle-c", availability: "available" });
  assert.deepEqual(await c.next(), { type: "ack", seq: 3 });
  const pub = gateway.publicView().find((r) => r.robotId === "rbt-test-1")!;
  assert.equal(pub.online, true);
  assert.equal(pub.availability, "available");
  assert.equal("batteryPct" in pub, false); // public view stays coarse

  c.send({ type: "heartbeat", seq: 3, ts: now(), batteryPct: 87, safetyState: "NORMAL", availability: "available" });
  assert.equal((await c.next()).code, "replay");

  const sent = gateway.assign("rbt-test-1", { skill: "warehouse.inspection", plan: { waypoints: 3, distanceM: 120, privacy: "private" } });
  assert.equal(sent.ok, true);
  const task = await c.next();
  assert.equal(task.type, "task_assignment");
  c.send({ type: "task_ack", seq: 4, ts: now(), taskId: task.taskId, accepted: true });
  assert.deepEqual(await c.next(), { type: "ack", seq: 4 });
  assert.ok(gateway.ownerView("rbt-test-1").events.some((e) => e.detail.includes("accepted")));

  c.send({ type: "heartbeat", seq: 5, ts: now(), batteryPct: 86, safetyState: "E_STOP", availability: "busy" });
  await c.next();
  assert.equal(gateway.assign("rbt-test-1", { skill: "warehouse.inspection", plan: { waypoints: 1, distanceM: 10, privacy: "private" } }).ok, false);

  c.ws.close();
  await c.closed;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(gateway.publicView().find((r) => r.robotId === "rbt-test-1")!.online, false);
  await app.close();
});

test("a token cannot speak for another robot, and revoking it closes the link", async () => {
  const { app, gateway, url } = await start();
  const token = gateway.links.issue("rbt-test-2", "0x00000000000000000000000000000000000000aa");
  const c = connect(url, token);
  await c.open;
  c.send({ type: "hello", seq: 1, ts: now(), robotId: "rbt-someone-else", softwareVersion: "0.1.0" });
  assert.equal((await c.next()).code, "wrong_robot");
  assert.equal(await c.closed, 4003);

  const d = connect(url, token);
  await d.open;
  d.send({ type: "hello", seq: 1, ts: now(), robotId: "rbt-test-2", softwareVersion: "0.1.0" });
  await d.next();
  gateway.links.revoke("rbt-test-2");
  gateway.disconnect("rbt-test-2");
  assert.equal(await d.closed, 4005);
  await assert.rejects(connect(url, token).open, /HTTP 401/);
  await app.close();
});

test("runner: a robot's link token may send jobs only in its own name", async () => {
  const { app, gateway } = await start();
  const token = gateway.links.issue("rbt-test-3", "0x00000000000000000000000000000000000000aa");
  const base = { jobId: "job-000009", parentTaskId: "t", targetAgentId: "agt-x-000000", capabilityId: "vision.inspection", input: {}, budgetLimit: "1", deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "idem-000009" };
  const other = await app.inject({ method: "POST", url: "/api/agents/agt-x-000000/jobs", headers: { authorization: `Bearer ${token}` }, payload: { ...base, requestingRobotId: "rbt-someone" } });
  assert.equal(other.statusCode, 403);
  const bad = await app.inject({ method: "POST", url: "/api/agents/agt-x-000000/jobs", headers: { authorization: "Bearer slk_wrong" }, payload: { ...base, requestingRobotId: "rbt-test-3" } });
  assert.equal(bad.statusCode, 401);
  const none = await app.inject({ method: "POST", url: "/api/agents/agt-x-000000/jobs", payload: { ...base, requestingRobotId: "rbt-test-3" } });
  assert.equal(none.statusCode, 401);
  // authorised: reaches the runner (none configured in this test app → 503, not 401/403)
  const ok = await app.inject({ method: "POST", url: "/api/agents/agt-x-000000/jobs", headers: { authorization: `Bearer ${token}` }, payload: { ...base, requestingRobotId: "rbt-test-3" } });
  assert.equal(ok.statusCode, 503);
  await app.close();
});
