/**
 * 0G Router preflight. Without a key: checks the public catalog for the configured models.
 * With ZEROG_ROUTER_API_KEY: also makes one tiny real inference in the required trust mode and
 * prints the provider request ID. Never prints the key.
 */
import { randomUUID } from "node:crypto";
import { ZeroGRouter, zeroGConfigFromEnv } from "@semmal/zerog-pc-adapter";

const router = new ZeroGRouter(zeroGConfigFromEnv());
const mode = router.config.requiredTrustMode;
for (const [label, id, img] of [
  ["vision", process.env.ZEROG_VISION_MODEL, true],
  ["text", router.config.defaultModel, false],
] as const) {
  if (!id) { console.log(label, "model: not set"); continue; }
  const c = await router.checkModel(id, mode, img);
  console.log(`${label} model ${id} in ${mode} mode:`, c.status.toUpperCase(), c.reason ?? "");
}
if (!router.configured) {
  console.log("ZEROG_ROUTER_API_KEY not set: skipped live inference.");
  process.exit(0);
}
const r = await router.chat({
  correlationId: randomUUID(), taskId: "preflight", robotId: "robot-demo-001", agentId: "semmal-preflight",
  purpose: "planning", model: router.config.defaultModel, trustRequirement: mode,
  messages: [{ role: "user", content: 'Reply with {"status":"ok"}' }], maxTokens: 20, verifyTee: true,
});
console.log({ providerRequestId: r.providerRequestId, chatId: r.chatId, model: r.model, requestedTrustMode: r.requestedTrustMode,
  trustEvidence: r.trustEvidence, latencyMs: r.latencyMs, billing: r.billing, output: r.output.slice(0, 80) });
