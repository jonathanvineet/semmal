import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ArkivRegistry, arkivConfigFromEnv } from "@semmal/arkiv-adapter";
import { ZeroGError, ZeroGRouter, zeroGConfigFromEnv } from "@semmal/zerog-pc-adapter";
import { loadConfig } from "./config";
import { PricingPolicy, RobotSkill, TrustMode, robotIdFromWallet } from "@semmal/contracts";
import { agentJobPrice, AGENT_TOKENS, quoteTask, SKILL_NEEDS } from "@semmal/quote";
import { z } from "zod";
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
    registry: new ArkivRegistry(arkivConfigFromEnv()),
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
  /** The instance owner's wallet, signed in with SIWE. */
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const address = sessionAddress(req);
    if (!address) return reply.code(401).send({ error: "Sign in with your wallet first" });
    if (admin.roleOf(address) !== "owner") return reply.code(403).send({ error: "Only the owner wallet can do this" });
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

  app.post<{ Body: { address?: string } }>("/api/admin/transfer", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      admin.update(sessionAddress(req)!, "transfer_owner", String(req.body?.address ?? ""));
      return admin.snapshot;
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });


  const robotsFromArkiv = cached(15_000, (owner) => registry.listRobots(owner ? { owner } : {}));
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

  /** Only what is on Arkiv. An outage returns an empty list and says so; nothing is filled in. */
  async function listing<T>(load: () => Promise<{ provenance: string; data: T }[]>) {
    try {
      const items = await load();
      return { arkiv: { ok: true, count: items.length }, items };
    } catch (e) {
      app.log.warn({ err: (e as Error).name }, "arkiv read failed");
      return { arkiv: { ok: false, error: "Arkiv could not be reached" }, items: [] };
    }
  }

  app.get<{ Querystring: { owner?: string } }>("/api/robots", async (req) => {
    const owner = req.query.owner && /^0x[0-9a-fA-F]{40}$/.test(req.query.owner) ? req.query.owner.toLowerCase() : "";
    return listing(() => robotsFromArkiv(owner));
  });

  app.get<{ Querystring: { kind?: string } }>("/api/agents", async (req) => {
    const kind = req.query.kind && /^[a-z-]{2,30}$/.test(req.query.kind) ? req.query.kind : "";
    return listing(() => agentsFromArkiv(kind));
  });

  /**
   * Before registering: is this robot wallet already on Arkiv, and by whom?
   * Same creator -> the next profile version (an update). Another creator -> taken.
   */
  app.get<{ Querystring: { wallet?: string; owner?: string } }>("/api/robots/check", async (req, reply) => {
    const { wallet, owner } = req.query;
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return reply.code(400).send({ error: "wallet must be a 0x address" });
    try {
      const found = await registry.robotsByWallet(wallet);
      const mine = owner ? found.filter((f) => f.creator.toLowerCase() === owner.toLowerCase()) : [];
      const others = found.filter((f) => !mine.includes(f));
      return {
        robotId: robotIdFromWallet(wallet),
        takenByOther: others.length > 0,
        existing: found,
        nextVersion: Math.max(0, ...mine.map((m) => m.profileVersion)) + 1,
      };
    } catch {
      return reply.code(502).send({ error: "Arkiv read failed; try again" });
    }
  });


  /** Read-only Arkiv JSON-RPC proxy: the browser never gets the access key and cannot send transactions here. */
  app.post("/api/arkiv/rpc", arkivRpcProxy(registry));

  // ---------------------------------------------------------------- task quotes
  const catalog = cached(5 * 60_000, () => router.listModels());
  const QuoteBody = z.object({
    robotId: z.string().max(64).optional(),
    preview: z.object({ robotType: z.string().max(40), policy: PricingPolicy }).optional(),
    plan: z.object({ skill: RobotSkill, waypoints: z.number().int().min(1).max(50), distanceM: z.number().min(0).max(20000), privacy: TrustMode }),
  });
  /**
   * The robot's quote for one task: live specialist prices from Arkiv, live 0G token prices from the
   * Router catalog, the robot's operating estimate, the owner's margin and limits. Deterministic.
   */
  app.post("/api/quote", async (req, reply) => {
    const body = QuoteBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid quote request", issues: body.error.issues });
    const { robotId, preview, plan } = body.data;
    let robotType: string, policy: z.infer<typeof PricingPolicy>, robotName: string | undefined;
    try {
      if (robotId) {
        const robot = (await registry.listRobots({ robotId }))[0];
        if (!robot) return reply.code(404).send({ error: "robot not found on Arkiv" });
        if (!robot.data.pricing) return reply.code(409).send({ error: "this robot has an old fixed-price profile; publish a new version with a pricing policy" });
        if (!robot.data.capabilities.includes(plan.skill)) return reply.code(409).send({ error: "this robot does not offer that skill" });
        robotType = robot.data.robotType;
        policy = robot.data.pricing;
        robotName = robot.data.displayName;
      } else if (preview) {
        robotType = preview.robotType;
        policy = preview.policy;
      } else return reply.code(400).send({ error: "robotId or preview required" });

      const agents = await registry.listAgents().catch(() => []);
      const offers = agents.map((a) => ({
        agentId: a.data.agentId,
        name: a.data.displayName,
        kind: a.data.kind,
        price: a.data.price.amount,
        trustMode: (a.data.inference?.trustMode ?? "none") as "private" | "verified" | "standard" | "none",
      }));
      // inference calls the plan needs: one check per waypoint for looking jobs, one call otherwise
      const looks = (SKILL_NEEDS[plan.skill]?.kinds.length ?? 0) > 0;
      const checkpoints = looks ? plan.waypoints : 1;
      const modelId = process.env.ZEROG_VISION_MODEL || router.config.defaultModel;
      let inference = null;
      if (modelId && router.config.baseUrl) {
        const m = (await catalog("").catch(() => [])).find((x) => x.id === modelId);
        if (m?.pricing?.prompt && m.pricing.completion) inference = { model: m.id, promptNeuron: m.pricing.prompt, completionNeuron: m.pricing.completion };
      }
      const rate = usdcRate();
      const q = quoteTask({ robotType, policy, plan: { ...plan, checkpoints }, offers, inference, zerogUsdcRate: rate });
      return { robotId: robotId ?? null, robotName, plan: { ...plan, checkpoints }, policy, ...q, quotedAt: new Date().toISOString() };
    } catch {
      return reply.code(502).send({ error: "could not read Arkiv or the 0G catalog; try again" });
    }
  });

  const usdcRate = () => (process.env.ZEROG_USDC_RATE && /^\d+(\.\d+)?$/.test(process.env.ZEROG_USDC_RATE) ? process.env.ZEROG_USDC_RATE : null);

  /**
   * The live 0G Router model list, normalised for the agent builder. Public data (no key needed).
   * `verifiability` can be missing on some gateway instances: then trust is "unconfirmed".
   */
  app.get("/api/zerog/catalog", async (_req, reply) => {
    if (!router.config.baseUrl) return reply.code(503).send({ error: "ZEROG_ROUTER_BASE_URL is not set" });
    try {
      const models = await catalog("");
      return {
        source: "ZEROG_ROUTER",
        rateConfigured: usdcRate() !== null,
        rate: usdcRate(),
        models: models
          .filter((m) => m.pricing?.prompt && m.pricing.completion && (m.architecture?.output_modalities ?? ["text"]).includes("text"))
          .map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            inputs: m.architecture?.input_modalities ?? ["text"],
            verifiability: m.verifiability ?? null,
            promptNeuron: m.pricing!.prompt!,
            completionNeuron: m.pricing!.completion!,
            contextLength: m.context_length ?? null,
          }))
          .sort((a, b) => Number(BigInt(a.promptNeuron) - BigInt(b.promptNeuron))),
      };
    } catch {
      return reply.code(502).send({ error: "could not read the 0G model list" });
    }
  });

  /** Suggested per-job price for an agent on a given 0G model: live model cost for one job + margin. */
  app.post<{ Body: { model?: string; kind?: string; marginPct?: number } }>("/api/agents/price", async (req, reply) => {
    const { model, kind, marginPct } = req.body ?? {};
    if (!model || !kind || !(kind in AGENT_TOKENS) || typeof marginPct !== "number" || marginPct < 0 || marginPct > 500)
      return reply.code(400).send({ error: "model, kind and marginPct (0-500) required" });
    const rate = usdcRate();
    if (!rate) return reply.code(409).send({ error: "No 0G to USDC rate configured (ZEROG_USDC_RATE); the price is not guessed" });
    try {
      const m = (await catalog("")).find((x) => x.id === model);
      if (!m?.pricing?.prompt || !m.pricing.completion) return reply.code(404).send({ error: "model not in the 0G catalog right now" });
      const p = agentJobPrice(kind, { promptNeuron: m.pricing.prompt, completionNeuron: m.pricing.completion }, rate, marginPct);
      return { model, kind, rate, tokensIn: p.tokensIn, tokensOut: p.tokensOut, cost: p.cost, price: p.price };
    } catch {
      return reply.code(502).send({ error: "could not read the 0G model list" });
    }
  });

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
