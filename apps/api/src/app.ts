import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ArkivRegistry, arkivConfigFromEnv } from "@semmal/arkiv-adapter";
import { ZeroGError, ZeroGRouter, zeroGConfigFromEnv } from "@semmal/zerog-pc-adapter";
import { loadConfig } from "./config";
import { agentFixtures, robotFixtures } from "./fixtures";
import { arkivRpcProxy } from "./arkiv-rpc-proxy";

type Deps = { registry: ArkivRegistry; router: ZeroGRouter; config: ReturnType<typeof loadConfig> };

export function defaultDeps(): Deps {
  return {
    config: loadConfig(),
    registry: new ArkivRegistry(arkivConfigFromEnv()),
    router: new ZeroGRouter(zeroGConfigFromEnv()),
  };
}

/** Tiny TTL cache so the dashboard does not hammer the (rate-limited) Arkiv RPC. */
function cached<T>(ttlMs: number, fn: (key: string) => Promise<T>) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = fn(key);
    store.set(key, { at: Date.now(), value });
    value.catch(() => store.delete(key));
    return value;
  };
}

export function buildApp(deps: Deps = defaultDeps()) {
  const { registry, router, config } = deps;
  const app = Fastify({
    logger: {
      level: "info",
      // Never log bodies (prompts/images) or auth headers.
      serializers: { req: (r) => ({ method: r.method, url: r.url }) },
    },
    bodyLimit: 256 * 1024,
  });
  app.register(cors, { origin: config.WEB_ORIGIN });

  const requireOperator = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = config.OPERATOR_TOKEN;
    const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const ok = token && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!ok) return reply.code(401).send({ error: "operator token required" });
  };

  const showSim = config.SHOW_SIMULATED_FIXTURES === "true";
  const robotsFromArkiv = cached(15_000, () => registry.listRobots());
  const agentsFromArkiv = cached(15_000, (kind) => registry.listAgents(kind ? { kind } : {}));

  app.get("/api/health", async () => ({ ok: true, mode: config.APP_MODE }));

  app.get("/api/integrations/status", async () => {
    const arkiv = await registry.status();
    let zerog: Record<string, unknown> = { configured: router.configured, baseUrlSet: Boolean(router.config.baseUrl) };
    if (router.config.baseUrl) {
      try {
        const vision = process.env.ZEROG_VISION_MODEL || "";
        const text = router.config.defaultModel;
        zerog = {
          ...zerog,
          requiredTrustMode: router.config.requiredTrustMode,
          visionModel: vision ? { id: vision, ...(await router.checkModel(vision, router.config.requiredTrustMode, true)) } : null,
          textModel: text ? { id: text, ...(await router.checkModel(text, router.config.requiredTrustMode, false)) } : null,
        };
      } catch (e) {
        zerog = { ...zerog, catalogError: (e as Error).message };
      }
    }
    return { mode: config.APP_MODE, arkiv, zerog };
  });

  async function listing<T>(load: () => Promise<{ provenance: string; data: T }[]>, sim: T[]) {
    try {
      const items = await load();
      if (items.length === 0 && showSim) return { arkiv: { ok: true, count: 0 }, items: sim.map((data) => ({ provenance: "SIMULATED", data })) };
      return { arkiv: { ok: true, count: items.length }, items };
    } catch (e) {
      app.log.warn({ err: (e as Error).name }, "arkiv read failed");
      return {
        arkiv: { ok: false, error: "Arkiv read failed (check ARKIV_ACCESS_KEY / network)" },
        items: showSim ? sim.map((data) => ({ provenance: "SIMULATED", data })) : [],
      };
    }
  }

  app.get("/api/robots", async () => listing(() => robotsFromArkiv(""), robotFixtures()));

  app.get<{ Querystring: { kind?: string } }>("/api/agents", async (req) => {
    const kind = req.query.kind && /^[a-z-]{2,30}$/.test(req.query.kind) ? req.query.kind : "";
    return listing(
      () => agentsFromArkiv(kind),
      agentFixtures().filter((a) => !kind || a.kind === kind),
    );
  });

  /** Draft profiles for the wallet publish page. Public data only; the browser sets ownerWallet. */
  app.get("/api/registry/drafts", async () => ({ robots: robotFixtures(), agents: agentFixtures(), ttlDays: registry.config.profileTtlDays }));

  /** Read-only Arkiv JSON-RPC proxy: the browser never gets the access key and cannot send transactions here. */
  app.post("/api/arkiv/rpc", arkivRpcProxy(registry));

  /** Public catalog subset: models that can serve private mode, and vision models. */
  app.get("/api/zerog/models", async (_req, reply) => {
    try {
      const models = await router.listModels();
      return {
        source: "ZEROG_ROUTER",
        private: models.filter((m) => m.verifiability === "TeeML").map((m) => ({ id: m.id, input: m.architecture?.input_modalities })),
      };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /**
   * Operator-only live probe: one real, tiny, non-sensitive inference in the required trust mode.
   * Returns the provider request ID and metadata. Never fabricates a result.
   */
  app.post("/api/zerog/probe", { preHandler: requireOperator }, async (_req, reply) => {
    const correlationId = randomUUID();
    const model = router.config.defaultModel;
    if (!model) return reply.code(400).send({ error: "ZEROG_DEFAULT_MODEL is not set" });
    try {
      const result = await router.chat({
        correlationId,
        taskId: "preflight",
        robotId: process.env.ROBOT_ID || "robot-demo-001",
        agentId: "semmal-preflight",
        purpose: "planning",
        model,
        trustRequirement: router.config.requiredTrustMode,
        messages: [{ role: "user", content: 'Reply with the JSON {"status":"ok"} and nothing else.' }],
        maxTokens: 20,
        verifyTee: true,
      });
      return { ...result, output: result.output.slice(0, 200) };
    } catch (e) {
      const err = e as ZeroGError;
      return reply.code(err.httpStatus === 503 ? 503 : 502).send({
        correlationId,
        error: err.message,
        code: err.code,
        providerRequestId: err.providerRequestId,
        note: "No result was fabricated.",
      });
    }
  });

  return app;
}
