import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
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
import { AgentRunner, type Caller } from "./runner";
import { fetchBundle, verifyEpisode, verifyIncident } from "./verify";
import { Gateway, LinkStore, MAX_MESSAGE_BYTES } from "./gateway";
import websocket from "@fastify/websocket";
import { GALILEO_RPC, galileoClient, verifyTransfer } from "@semmal/zerog-pay";

type Deps = { registry: ArkivRegistry; router: ZeroGRouter; config: ReturnType<typeof loadConfig>; admin: AdminStore; auth: WalletAuth; runner?: AgentRunner; gateway?: Gateway };

export function defaultDeps(): Deps {
  const config = loadConfig();
  const admin = new AdminStore(config.ADMIN_STORE_PATH);
  const registry = new ArkivRegistry(arkivConfigFromEnv());
  const router = new ZeroGRouter(zeroGConfigFromEnv());
  const runner = new AgentRunner(
    router,
    async (agentId) => (await registry.listAgents({ agentId }))[0]?.data ?? null,
    process.env.AGENT_JOBS_DB || "../../data/agent-jobs.db",
    // robot payments are checked on 0G Galileo before an agent runs
    (want) => verifyTransfer(galileoClient(process.env.ZEROG_PAY_RPC_URL || GALILEO_RPC), want),
  );
  const gateway = new Gateway(new LinkStore(process.env.ROBOT_LINKS_PATH || "../../data/robot-links.json"));
  return { config, admin, auth: new WalletAuth(new URL(config.WEB_ORIGIN).host), registry, router, runner, gateway };
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
  const { registry, router, config, admin, auth, runner, gateway } = deps;
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
      // only agents priced in 0G can be paid by the robot
      const offers = agents.filter((a) => a.data.price.token === "0G").map((a) => ({
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
      const q = quoteTask({ robotType, policy, plan: { ...plan, checkpoints }, offers, inference });
      return { robotId: robotId ?? null, robotName, plan: { ...plan, checkpoints }, policy, ...q, quotedAt: new Date().toISOString() };
    } catch {
      return reply.code(502).send({ error: "could not read Arkiv or the 0G catalog; try again" });
    }
  });

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
        token: "0G",
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
    try {
      const m = (await catalog("")).find((x) => x.id === model);
      if (!m?.pricing?.prompt || !m.pricing.completion) return reply.code(404).send({ error: "model not in the 0G catalog right now" });
      const p = agentJobPrice(kind, { promptNeuron: m.pricing.prompt, completionNeuron: m.pricing.completion }, marginPct);
      return { model, kind, token: "0G", tokensIn: p.tokensIn, tokensOut: p.tokensOut, cost: p.cost, price: p.price };
    } catch {
      return reply.code(502).send({ error: "could not read the 0G model list" });
    }
  });

  // ---------------------------------------------------------------- robot gateway
  /** The wallet signed in now must be the robot's owner on Arkiv. */
  async function ownedRobot(req: FastifyRequest, robotId: string) {
    const address = sessionAddress(req);
    if (!address) return { error: 401, message: "Sign in with your wallet first" } as const;
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(robotId)) return { error: 400, message: "bad robot id" } as const;
    const robot = (await registry.listRobots({ robotId }).catch(() => []))[0];
    if (!robot) return { error: 404, message: "Robot not found on Arkiv" } as const;
    if (robot.data.ownerWallet.toLowerCase() !== address.toLowerCase()) return { error: 403, message: "Only the robot's owner wallet can do this" } as const;
    return { robot, address } as const;
  }

  if (gateway) {
    app.register(async (scope) => {
      await scope.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
      scope.get(
        "/api/gateway",
        {
          websocket: true,
          preValidation: async (req, reply) => {
            const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
            const link = gateway.links.verify(token);
            if (!link) return reply.code(401).send({ error: "invalid or revoked link token" });
            (req as FastifyRequest & { robotId?: string }).robotId = link.robotId;
          },
        },
        (socket, req) => gateway.attach(socket, (req as FastifyRequest & { robotId: string }).robotId),
      );
    });
    app.addHook("onClose", async () => gateway.stop());
  }

  /** Create (or replace) the robot's link token. Shown once; only its hash is kept. */
  app.post<{ Params: { robotId: string } }>("/api/robots/:robotId/link", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    const own = await ownedRobot(req, req.params.robotId);
    if ("error" in own) return reply.code(own.error as number).send({ error: own.message });
    gateway.disconnect(req.params.robotId);
    const token = gateway.links.issue(req.params.robotId, own.address);
    // the addresses a robot PC on the same network can use to reach this API
    const platformHosts = (process.env.API_HOST && process.env.API_HOST !== "127.0.0.1")
      ? Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n!.address)
      : [];
    return { robotId: req.params.robotId, token, gatewayPath: "/api/gateway", port: config.API_PORT, platformHosts, note: "Shown once. Store it on the robot host only." };
  });

  app.delete<{ Params: { robotId: string } }>("/api/robots/:robotId/link", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    const own = await ownedRobot(req, req.params.robotId);
    if ("error" in own) return reply.code(own.error as number).send({ error: own.message });
    gateway.disconnect(req.params.robotId);
    return { revoked: gateway.links.revoke(req.params.robotId) };
  });

  /** Public, coarse live status for the marketplace: online and availability only. */
  app.get("/api/robots/live", async () => ({ robots: gateway ? gateway.publicView() : [] }));

  app.get<{ Params: { robotId: string } }>("/api/robots/:robotId/live", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    const own = await ownedRobot(req, req.params.robotId);
    if ("error" in own) return reply.code(own.error as number).send({ error: own.message });
    return gateway.ownerView(req.params.robotId);
  });

  /** Owner sends a task straight to their connected robot (customer booking comes later). */
  app.post<{ Params: { robotId: string } }>("/api/robots/:robotId/tasks", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    const own = await ownedRobot(req, req.params.robotId);
    if ("error" in own) return reply.code(own.error as number).send({ error: own.message });
    const body = z
      .object({ skill: RobotSkill, waypoints: z.number().int().min(1).max(50), distanceM: z.number().min(0).max(20000), privacy: TrustMode })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid task", issues: body.error.issues });
    if (!own.robot.data.capabilities.includes(body.data.skill)) return reply.code(409).send({ error: "this robot does not offer that skill" });
    const r = gateway.assign(req.params.robotId, { skill: body.data.skill, plan: { waypoints: body.data.waypoints, distanceM: body.data.distanceM, privacy: body.data.privacy } });
    return r.ok ? { taskId: r.taskId } : reply.code(409).send({ error: r.reason });
  });

  // ---------------------------------------------------------------- bookings, offers, evidence (Arkiv)
  /** A task with the robot's offers and job claims: everything public about it on Arkiv. */
  app.get<{ Params: { taskId: string } }>("/api/tasks/:taskId", async (req, reply) => {
    if (!/^task-[a-z0-9-]{6,58}$/.test(req.params.taskId)) return reply.code(400).send({ error: "bad task id" });
    try {
      const task = (await registry.listTasks({ taskId: req.params.taskId }))[0];
      if (!task) return reply.code(404).send({ error: "task not on Arkiv (or expired)" });
      const [quotes, claims] = await Promise.all([registry.listQuotes(req.params.taskId), registry.listJobClaims(req.params.taskId)]);
      const live = gateway?.publicView().find((r) => r.robotId === task.data.robotId);
      const events = gateway ? gateway.taskEvents(task.data.robotId, task.data.taskId) : [];
      return { task, quotes, claims, events, robot: live ?? { robotId: task.data.robotId, online: false, availability: "offline" } };
    } catch {
      return reply.code(502).send({ error: "Arkiv could not be reached" });
    }
  });

  /**
   * After the customer's wallet put the booking on Arkiv, hand it to the robot. The booking itself is
   * the authority: it is read back from Arkiv (owner = customer) and checked before dispatch.
   */
  app.post<{ Params: { taskId: string } }>("/api/tasks/:taskId/dispatch", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    if (!/^task-[a-z0-9-]{6,58}$/.test(req.params.taskId)) return reply.code(400).send({ error: "bad task id" });
    const task = (await registry.listTasks({ taskId: req.params.taskId }).catch(() => []))[0];
    if (!task) return reply.code(404).send({ error: "booking not found on Arkiv yet; try again in a few seconds" });
    if (Date.parse(task.data.deadline) <= Date.now()) return reply.code(409).send({ error: "the booking's deadline has passed" });
    const robot = (await registry.listRobots({ robotId: task.data.robotId }).catch(() => []))[0];
    if (!robot) return reply.code(404).send({ error: "robot not on Arkiv" });
    if (!robot.data.capabilities.includes(task.data.skill)) return reply.code(409).send({ error: "this robot does not offer that skill" });
    const r = gateway.assign(task.data.robotId, {
      taskId: task.data.taskId,
      skill: task.data.skill,
      plan: task.data.plan,
      maxBudget: task.data.maxBudget,
      deadline: task.data.deadline,
      customerWallet: task.data.customerWallet,
    });
    return r.ok ? { taskId: r.taskId, dispatched: true } : reply.code(409).send({ error: r.reason });
  });

  /**
   * The customer paid the robot's quote from their own wallet. Pass the transaction hash to the robot;
   * the robot checks it on 0G Galileo itself (payee, amount, memo, payer) before it starts. The
   * platform never holds or moves the money.
   */
  app.post<{ Params: { taskId: string }; Body: { txHash?: string } }>("/api/tasks/:taskId/payment", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "gateway not available" });
    const txHash = req.body?.txHash ?? "";
    if (!/^task-[a-z0-9-]{6,58}$/.test(req.params.taskId) || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return reply.code(400).send({ error: "task id and transaction hash required" });
    const task = (await registry.listTasks({ taskId: req.params.taskId }).catch(() => []))[0];
    if (!task) return reply.code(404).send({ error: "booking not found on Arkiv" });
    const r = gateway.paymentNotice(task.data.robotId, task.data.taskId, txHash);
    return r.ok ? { forwarded: true } : reply.code(409).send({ error: r.reason });
  });

  app.get<{ Params: { robotId: string } }>("/api/robots/:robotId/evidence", async (req, reply) => {
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(req.params.robotId)) return reply.code(400).send({ error: "bad robot id" });
    try {
      const [episodes, incidents] = await Promise.all([registry.listEpisodes(req.params.robotId), registry.listIncidents(req.params.robotId)]);
      return { episodes, incidents };
    } catch {
      return reply.code(502).send({ error: "Arkiv could not be reached" });
    }
  });

  /** Download an episode or incident bundle from 0G Storage with proof and verify it end to end. */
  app.get<{ Params: { robotId: string; kind: string; id: string } }>("/api/evidence/:robotId/:kind/:id", async (req, reply) => {
    const { robotId, kind, id } = req.params;
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(robotId) || !["episode", "incident"].includes(kind) || !/^[A-Za-z0-9-]{3,64}$/.test(id)) return reply.code(400).send({ error: "bad request" });
    try {
      const robot = (await registry.listRobots({ robotId }))[0];
      if (!robot) return reply.code(404).send({ error: "robot not on Arkiv" });
      const records = kind === "episode" ? await registry.listEpisodes(robotId) : await registry.listIncidents(robotId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = records.find((r: any) => (kind === "episode" ? r.data.episodeId : r.data.incidentId) === id);
      if (!rec) return reply.code(404).send({ error: `${kind} not on Arkiv` });
      const indexer = process.env.ZEROG_STORAGE_INDEXER_URL || "https://indexer-storage-testnet-turbo.0g.ai";
      const got = await fetchBundle(indexer, rec.data.storageRoot, process.env.EVIDENCE_CACHE_DIR || "../../data/evidence-cache");
      if (!got.ok) return { record: rec, checks: { storageProof: false, manifestHash: null, signature: false, arkivLink: false, detail: [`download with proof failed: ${got.error}`] } };
      const checks = kind === "episode" ? await verifyEpisode(got.text, rec.data, robot.data.robotWallet) : await verifyIncident(got.text, rec.data, robot.data.robotWallet);
      return { record: rec, bundle: JSON.parse(got.text), checks };
    } catch (e) {
      return reply.code(502).send({ error: `verification could not run: ${(e as Error).message}` });
    }
  });

  // ---------------------------------------------------------------- agent runner
  /**
   * Run one job for a specialist agent listed on Arkiv. For now only the owner wallet may send jobs
   * (the test console); robots will send them through the authenticated robot gateway next.
   */
  /**
   * Who may send a job: a linked robot (its link token; the job must name that robot), or the owner
   * wallet's session (the dashboard's test console). Robots are rate limited.
   */
  const jobBucket = new Map<string, { n: number; at: number }>();
  const JOBS_PER_MIN = 30;
  const authorizeJob = async (req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (bearer.startsWith("slk_")) {
      const link = gateway?.links.verify(bearer);
      if (!link) return reply.code(401).send({ error: "invalid or revoked link token" });
      const named = (req.body as { requestingRobotId?: string } | undefined)?.requestingRobotId;
      if (named !== link.robotId) return reply.code(403).send({ error: "requestingRobotId must be the robot this token belongs to" });
      const b = jobBucket.get(link.robotId);
      const now = Date.now();
      if (!b || now - b.at > 60_000) jobBucket.set(link.robotId, { n: 1, at: now });
      else if (++b.n > JOBS_PER_MIN) return reply.code(429).send({ error: `at most ${JOBS_PER_MIN} jobs a minute per robot` });
      return;
    }
    return requireAdmin(req, reply);
  };

  app.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/jobs",
    { preHandler: authorizeJob, bodyLimit: 3 * 1024 * 1024 },
    async (req, reply) => {
      if (!runner) return reply.code(503).send({ error: "agent runner is not available" });
      if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(req.params.agentId)) return reply.code(400).send({ error: "bad agent id" });
      // a robot pays from the wallet on its Arkiv profile; the owner's console runs unpaid tests
      let caller: Caller = { kind: "owner" };
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (bearer.startsWith("slk_")) {
        const link = gateway!.links.verify(bearer)!;
        const robot = (await registry.listRobots({ robotId: link.robotId }).catch(() => []))[0];
        if (!robot) return reply.code(404).send({ error: "this robot is not on Arkiv" });
        caller = { kind: "robot", robotId: link.robotId, robotWallet: robot.data.robotWallet };
      }
      const result = await runner.run(req.params.agentId, req.body, caller);
      return reply.code(result.status === "rejected" ? 400 : 200).send(result);
    },
  );

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
