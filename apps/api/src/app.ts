import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ArkivRegistry, arkivConfigFromEnv } from "@semmal/arkiv-adapter";
import { ZeroGError, ZeroGRouter, zeroGConfigFromEnv } from "@semmal/zerog-pc-adapter";
import { loadConfig } from "./config";
import { agentFixtures, robotFixtures } from "./fixtures";
import { arkivRpcProxy } from "./arkiv-rpc-proxy";
import { AdminStore, readCookie, WalletAuth } from "./admin";

type Deps = { registry: ArkivRegistry; router: ZeroGRouter; config: ReturnType<typeof loadConfig>; admin: AdminStore; auth: WalletAuth };

export function defaultDeps(): Deps {
  const config = loadConfig();
  const admin = new AdminStore(config.ADMIN_STORE_PATH);
  return {
    config,
    admin,
    auth: new WalletAuth(new URL(config.WEB_ORIGIN).host),
    registry: new ArkivRegistry(arkivConfigFromEnv(process.env, () => admin.trustedPublishers())),
    router: new ZeroGRouter(zeroGConfigFromEnv()),
  };
}

const SID = "semmal_sid";

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
  const { registry, router, config, admin, auth } = deps;
  const app = Fastify({
    logger: {
      level: "info",
      // Never log bodies (prompts/images) or auth headers.
      serializers: { req: (r) => ({ method: r.method, url: r.url }) },
    },
    bodyLimit: 256 * 1024,
  });
  app.register(cors, { origin: config.WEB_ORIGIN });

  const sessionAddress = (req: FastifyRequest) => auth.addressFor(readCookie(req.headers.cookie, SID));
  /** Owner or admin wallet, signed in with SIWE. */
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const address = sessionAddress(req);
    if (!address) return reply.code(401).send({ error: "Sign in with your wallet first" });
    if (admin.roleOf(address) === "none") return reply.code(403).send({ error: "This wallet is not an owner or admin" });
  };

  // ---------------------------------------------------------------- wallet sign-in (EIP-4361)
  app.get("/api/auth/nonce", async () => ({ nonce: auth.issueNonce() }));

  app.post<{ Body: { message?: string; signature?: string } }>("/api/auth/verify", async (req, reply) => {
    const { message, signature } = req.body ?? {};
    if (typeof message !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || message.length > 2000)
      return reply.code(400).send({ error: "message and signature required" });
    try {
      const { sid, address } = await auth.verify(message, signature as `0x${string}`);
      const secure = config.WEB_ORIGIN.startsWith("https://") ? "; Secure" : "";
      reply.header("set-cookie", `${SID}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
      return { address, role: admin.roleOf(address), ownerSet: Boolean(admin.snapshot.owner) };
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message });
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    auth.end(readCookie(req.headers.cookie, SID));
    reply.header("set-cookie", `${SID}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const address = sessionAddress(req);
    return { address, role: address ? admin.roleOf(address) : "none", ownerSet: Boolean(admin.snapshot.owner) };
  });

  // ---------------------------------------------------------------- admin
  app.post<{ Body: { code?: string } }>("/api/admin/claim", async (req, reply) => {
    const address = sessionAddress(req);
    if (!address) return reply.code(401).send({ error: "Sign in with your wallet first" });
    try {
      admin.claimOwnership(address, String(req.body?.code ?? ""));
      app.log.info({ owner: address }, "ownership claimed");
      return { address, role: admin.roleOf(address) };
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  app.get("/api/admin/state", { preHandler: requireAdmin }, async () => admin.snapshot);

  app.post<{ Body: { action?: string; address?: string } }>("/api/admin/roles", { preHandler: requireAdmin }, async (req, reply) => {
    const actions = ["add_admin", "remove_admin", "add_publisher", "remove_publisher", "transfer_owner"] as const;
    const action = actions.find((a) => a === req.body?.action);
    if (!action) return reply.code(400).send({ error: "unknown action" });
    try {
      admin.update(sessionAddress(req)!, action, String(req.body?.address ?? ""));
      return admin.snapshot;
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

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
  app.post("/api/zerog/probe", { preHandler: requireAdmin }, async (_req, reply) => {
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
