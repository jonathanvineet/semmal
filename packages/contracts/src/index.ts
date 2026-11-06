/**
 * SEMMAL shared contracts, v1.
 * These are APPLICATION schemas. They are not vendor wire formats.
 * Every value that crosses a trust boundary (specialist output, model output, registry entity)
 * is parsed with one of these before it is used.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;

/** Where a value came from. The UI shows this next to every integration value. */
export const Provenance = z.enum(["ARKIV", "ZEROG_ROUTER"]);
export type Provenance = z.infer<typeof Provenance>;

const id = z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimalAmount = z.string().regex(/^\d+(\.\d{1,18})?$/);

// ---------------------------------------------------------------- robots
export const RobotType = z.enum([
  "diff-drive-indoor",
  "diff-drive-outdoor",
  "aerial-multirotor",
  "legged-quadruped",
  "fixed-arm",
  "dexterous-hand",
  "humanoid",
  "mobile-manipulator",
]);

export const ROBOT_SKILLS = [
  { id: "warehouse.inspection", label: "Inspection", hint: "Checks machines and panels at waypoints" },
  { id: "warehouse.patrol", label: "Patrol", hint: "Drives routes and reports what changed" },
  { id: "indoor.delivery", label: "Indoor delivery", hint: "Carries small items between zones" },
  { id: "aerial.inspection", label: "Aerial inspection", hint: "Flies to roofs, racks and towers to look closely" },
  { id: "aerial.mapping", label: "Mapping", hint: "Flies a grid and builds a map of a site" },
  { id: "site.inspection", label: "Site inspection", hint: "Walks stairs and rough ground to read gauges" },
  { id: "outdoor.patrol", label: "Outdoor patrol", hint: "Walks a perimeter and flags anything new" },
  { id: "manipulation.pick-place", label: "Pick and place", hint: "Moves parts and boxes from one spot to another" },
  { id: "manipulation.assembly", label: "Assembly", hint: "Fits, screws and joins parts" },
  { id: "manipulation.machine-tending", label: "Machine tending", hint: "Loads and unloads machines" },
  { id: "manipulation.dexterous", label: "Fine handling", hint: "Grips small or delicate objects with fingers" },
  { id: "assist.human", label: "Assist people", hint: "Hands over items and works next to people" },
  { id: "home.cleaning", label: "Home cleaning", hint: "Visits each room, finds spills and clutter, reports what it cleaned" },
] as const;
export const RobotSkill = z.enum([
  "warehouse.inspection", "warehouse.patrol", "indoor.delivery", "aerial.inspection", "aerial.mapping",
  "site.inspection", "outdoor.patrol", "manipulation.pick-place", "manipulation.assembly",
  "manipulation.machine-tending", "manipulation.dexterous", "assist.human", "home.cleaning",
]);

const SENSORS = ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery", "depth-camera", "gps", "barometer", "joint-encoders", "force-torque", "tactile"] as const;
export const Sensor = z.enum(SENSORS);

/**
 * Robot types SEMMAL can register. `asset` is the 3D model in apps/web/public/models (adapted
 * from MuJoCo Menagerie; see /credits).
 */
export const ROBOT_MODELS = [
  { id: "rover", name: "Compact rover", robotType: "diff-drive-indoor", asset: "rover", base: "Wheeled indoor base", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery"], skills: ["warehouse.inspection", "warehouse.patrol", "indoor.delivery"], note: "Small wheeled base for aisles, patrols and short deliveries." },
  { id: "cleaner", name: "Home cleaning robot", robotType: "diff-drive-indoor", asset: "rover", base: "Round wheeled base, low profile", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery"], skills: ["home.cleaning", "indoor.delivery"], note: "Low, round home robot. Visits rooms, spots spills and clutter." },
  { id: "field-rover", name: "Field rover", robotType: "diff-drive-outdoor", asset: "rover", base: "Rugged wheeled base", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "gps", "battery"], skills: ["outdoor.patrol", "site.inspection"], note: "Outdoor rover for trails and sites. Patrols and reports hazards." },
  { id: "drone", name: "Inspection drone", robotType: "aerial-multirotor", asset: "drone", base: "Quadcopter", sensors: ["rgb-camera", "imu", "gps", "barometer", "battery"], skills: ["aerial.inspection", "aerial.mapping"], note: "Flies to high or hard-to-reach places and maps sites." },
  { id: "quadruped", name: "Quadruped", robotType: "legged-quadruped", asset: "quadruped", base: "Four-legged base", sensors: ["depth-camera", "lidar-2d", "imu", "joint-encoders", "battery"], skills: ["site.inspection", "outdoor.patrol", "warehouse.patrol"], note: "Walks stairs and rough ground where wheels cannot go." },
  { id: "arm", name: "Robot arm", robotType: "fixed-arm", asset: "arm", base: "Six-axis arm", sensors: ["joint-encoders", "force-torque", "rgb-camera"], skills: ["manipulation.pick-place", "manipulation.assembly", "manipulation.machine-tending"], note: "Fixed six-axis arm for cells, benches and machines." },
  { id: "hand", name: "Dexterous hand", robotType: "dexterous-hand", asset: "hand", base: "Five-finger hand", sensors: ["joint-encoders", "tactile"], skills: ["manipulation.dexterous", "manipulation.assembly"], note: "Five fingers for small, delicate or oddly shaped parts." },
  { id: "humanoid", name: "Humanoid", robotType: "humanoid", asset: "humanoid", base: "Bipedal humanoid", sensors: ["depth-camera", "imu", "joint-encoders", "force-torque", "battery"], skills: ["manipulation.pick-place", "indoor.delivery", "assist.human"], note: "Works in spaces built for people, next to people." },
  { id: "manipulator", name: "Mobile manipulator", robotType: "mobile-manipulator", asset: "manipulator", base: "Wheeled base with an arm", sensors: ["lidar-2d", "depth-camera", "imu", "joint-encoders", "battery"], skills: ["manipulation.pick-place", "indoor.delivery", "warehouse.inspection"], note: "Drives to the job, then picks and places." },
] as const;
/** Older ids stay valid so profiles already on Arkiv still parse. */
export const RobotModelId = z.enum(["rover", "cleaner", "field-rover", "drone", "quadruped", "arm", "hand", "humanoid", "manipulator", "semmal-rover-sim", "custom-diff-drive"]);

/**
 * Where a robot works, at city or metro level only (never an exact site or live location).
 * Grouped by region for the picker; the stored value is the label itself.
 */
export const SERVICE_AREAS: { region: string; areas: string[] }[] = [
  { region: "India", areas: ["Chennai", "Bengaluru", "Hyderabad", "Mumbai", "Pune", "Delhi NCR", "Kolkata", "Ahmedabad", "Coimbatore", "Kochi", "Jaipur", "Chandigarh", "Visakhapatnam", "Madurai", "Tiruchirappalli", "Sriperumbudur industrial belt", "Hosur industrial belt"] },
  { region: "Middle East", areas: ["Dubai", "Abu Dhabi", "Riyadh", "Jeddah", "Doha", "Muscat", "Tel Aviv"] },
  { region: "South-east Asia", areas: ["Singapore", "Kuala Lumpur", "Penang", "Bangkok", "Jakarta", "Ho Chi Minh City", "Manila"] },
  { region: "East Asia", areas: ["Tokyo", "Osaka", "Seoul", "Busan", "Shenzhen", "Shanghai", "Hong Kong", "Taipei"] },
  { region: "Europe", areas: ["London", "Manchester", "Amsterdam", "Rotterdam", "Berlin", "Munich", "Hamburg", "Paris", "Lyon", "Madrid", "Barcelona", "Milan", "Zurich", "Stockholm", "Copenhagen", "Warsaw", "Dublin"] },
  { region: "North America", areas: ["San Francisco Bay Area", "Los Angeles", "Seattle", "Austin", "Dallas", "Chicago", "Detroit", "Boston", "New York", "Atlanta", "Toronto", "Montreal", "Vancouver", "Mexico City", "Monterrey"] },
  { region: "South America", areas: ["São Paulo", "Rio de Janeiro", "Buenos Aires", "Santiago", "Bogotá", "Lima"] },
  { region: "Africa", areas: ["Johannesburg", "Cape Town", "Nairobi", "Lagos", "Cairo", "Casablanca"] },
  { region: "Oceania", areas: ["Sydney", "Melbourne", "Brisbane", "Auckland"] },
  { region: "Anywhere", areas: ["Remote or on request"] },
];
export const ALL_SERVICE_AREAS = SERVICE_AREAS.flatMap((g) => g.areas);

/** The robot's unique id, derived from its own wallet so one robot cannot hold two ids. */
export const robotIdFromWallet = (wallet: string) => `rbt-${wallet.toLowerCase().replace(/^0x/, "").slice(0, 10)}`;

/**
 * The owner's guardrails. The owner never sets the price of a task: the robot's quote engine
 * prices each task from its real costs (specialists, 0G inference, its own operating time) plus
 * the margin, then keeps the result inside these limits or declines the task.
 */
export const PricingPolicy = z
  .object({
    /** Everything is priced and paid in the native 0G token (Galileo testnet for now). */
    token: z.literal("0G"),
    minFee: decimalAmount,
    maxQuote: decimalAmount,
    marginPct: z.number().min(0).max(200),
    /** The most the robot may spend on agents for one task (and, on an owner test task, from its own balance). */
    maxSpendPerTask: decimalAmount,
  })
  .refine((p) => Number(p.maxQuote) >= Number(p.minFee), { message: "maxQuote must be at least minFee" });
export type PricingPolicy = z.infer<typeof PricingPolicy>;

export const RobotProfile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  robotId: id,
  /** The robot's own identity wallet (public address only; no key ever enters SEMMAL). */
  robotWallet: evmAddress,
  /** The person or company wallet that registered it and signs its updates. */
  ownerWallet: evmAddress,
  displayName: z.string().min(2).max(40),
  model: RobotModelId,
  robotType: RobotType,
  hardware: z.object({
    base: z.string().max(80),
    sensors: z.array(Sensor).max(10),
  }),
  capabilities: z.array(RobotSkill).min(1).max(4),
  rosInterfaceVersion: z.string().max(16),
  profileVersion: z.number().int().min(1),
  /** Coarse only. Never an exact location. */
  serviceArea: z.string().max(40),
  /** The owner's limits; the robot quotes each task inside them. */
  pricing: PricingPolicy.optional(),
  /** Older profiles carried a fixed price; still readable, no longer written. */
  price: z.object({ amount: decimalAmount, token: z.string().max(12), unit: z.enum(["task", "hour"]) }).optional(),
}).refine((r) => r.pricing || r.price, { message: "a pricing policy is required" });
export type RobotProfile = z.infer<typeof RobotProfile>;

// ---------------------------------------------------------------- agents
export const AgentKind = z.enum(["vision", "inspection", "maintenance", "navigation", "delivery-verification"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const Capability = z.object({
  capabilityId: z.string().max(64).regex(/^[a-z]+(\.[a-z-]+)+$/),
  inputSchemaVersion: z.string().max(16),
  outputSchemaVersion: z.string().max(16),
  supportedRobotTypes: z.array(RobotType).min(1).max(8),
  supportedTaskTypes: z.array(z.string().max(40)).min(1).max(6),
});

export const AgentListing = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  agentId: id,
  ownerWallet: evmAddress,
  displayName: z.string().min(2).max(60),
  kind: AgentKind,
  summary: z.string().max(160),
  /** HTTPS service endpoint. Validated, never fetched by the browser. */
  endpoint: z.string().url().max(200),
  capabilities: z.array(Capability).min(1).max(4),
  price: z.object({ amount: decimalAmount, token: z.string().max(12), unit: z.enum(["job", "minute"]) }),
  /** The 0G model this specialist uses, if any, and the trust mode it requires. */
  inference: z
    .object({ model: z.string().max(80), trustMode: z.enum(["private", "verified", "standard"]) })
    .optional(),
  /** May this specialist hire other specialists, and up to what share of its job budget. */
  delegation: z.object({ allowed: z.boolean(), maxBudgetShare: z.number().min(0).max(1) }),
  serviceVersion: z.string().max(16),
});
export type AgentListing = z.infer<typeof AgentListing>;

/** Live state. Lives in the operational store, never in Arkiv. */
export const Availability = z.enum(["available", "busy", "offline"]);

/** A registry record as the API returns it. */
export const RegistryRecord = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    provenance: Provenance,
    entityKey: z.string().optional(),
    owner: z.string().optional(),
    expiresAtBlock: z.string().optional(),
    txHash: z.string().optional(),
    data: inner,
  });

// ---------------------------------------------------------------- inference
export const TrustMode = z.enum(["private", "verified", "standard"]);
export type TrustMode = z.infer<typeof TrustMode>;

export interface InferenceRequest {
  correlationId: string;
  taskId: string;
  robotId: string;
  agentId: string;
  purpose: "vision" | "planning" | "maintenance" | "speech";
  model: string;
  trustRequirement: TrustMode;
  /** OpenAI-compatible messages. Never logged. */
  messages: unknown[];
  responseFormat?: "json_object";
  maxTokens?: number;
  deadlineMs?: number;
  verifyTee?: boolean;
}

export interface InferenceResult {
  correlationId: string;
  provenance: Provenance;
  /** x_0g_trace.request_id, as returned by the Router. Absent means none was returned. */
  providerRequestId?: string;
  /** ZG-Res-Key response header (chat ID used for TEE verification), if present. */
  chatId?: string;
  providerAddress?: string;
  model: string;
  requestedTrustMode: TrustMode;
  /**
   * What the Router actually tells us. The Router does not echo the tier it used, so this is
   * "requested-enforced" (we sent the header; Router fails closed with 503 otherwise) unless
   * tee_verified came back true.
   */
  trustEvidence: "tee_verified" | "tee_verification_failed" | "requested_header_enforced_by_router";
  output: string;
  latencyMs: number;
  billing?: { inputCost?: string; outputCost?: string; totalCost?: string; unit: "neuron" };
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** OpenAI-style finish reason, e.g. "stop" or "length" (ran out of tokens). */
  finishReason?: string;
}

/** The vision specialist's strict application schema (CLAUDE.md section 7). */
export const VisionInspectionOutput = z.object({
  observation: z.string().max(60),
  anomaly_detected: z.boolean(),
  anomaly_type: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(1),
  recommended_action: z.enum(["continue_mission", "pause_and_request_inspection", "return_to_dock", "abort_mission"]),
});
export type VisionInspectionOutput = z.infer<typeof VisionInspectionOutput>;

// ---------------------------------------------------------------- agent jobs (runner)
/** A job a robot (or the owner's test console) sends to a specialist agent. CLAUDE.md 6.2. */
export const AgentJob = z.object({
  jobId: z.string().min(6).max(64),
  parentTaskId: z.string().min(1).max(64),
  requestingRobotId: z.string().min(1).max(64),
  requestingAgentId: z.string().max(64).optional(),
  targetAgentId: z.string().min(3).max(64),
  capabilityId: z.string().max(64),
  input: z.unknown(),
  budgetLimit: z.string().regex(/^\d+(\.\d{1,6})?$/),
  deadline: z.string().datetime(),
  idempotencyKey: z.string().min(8).max(100),
  /** A robot's payment for this job: a 0G transfer to the agent owner carrying memo semmal:job:<jobId>. */
  payment: z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).optional(),
});
export type AgentJob = z.infer<typeof AgentJob>;

const dataImage = z.string().max(2_000_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "a base64 data URL of a JPEG, PNG or WebP image");

/** What each agent kind accepts. Anything else is rejected before 0G is called. */
export const AGENT_INPUTS = {
  vision: z.object({ image: dataImage, context: z.string().max(300).optional() }),
  "delivery-verification": z.object({ image: dataImage, order: z.string().min(2).max(300) }),
  maintenance: z.object({ faultCode: z.string().max(60).optional(), diagnostics: z.record(z.string().max(40), z.union([z.number(), z.string().max(80), z.boolean()])).refine((d) => Object.keys(d).length <= 30) }),
  inspection: z.object({ target: z.string().min(2).max(200), stops: z.number().int().min(1).max(50), notes: z.string().max(400).optional() }),
  navigation: z.object({ stops: z.array(z.string().min(1).max(60)).min(1).max(30), constraints: z.string().max(300).optional() }),
} as const;

/** What each agent kind must return. Model output that does not match is a failed job. */
export const MaintenanceOutput = z.object({
  likely_cause: z.string().max(120),
  confidence: z.number().min(0).max(1),
  checks: z.array(z.string().max(120)).max(6),
  safe_to_resume: z.literal(false),
});
export const InspectionPlanOutput = z.object({
  steps: z.array(z.object({ stop: z.number().int().min(1), look_for: z.string().max(120) })).min(1).max(50),
  needs_vision: z.boolean(),
});
export const NavigationPlanOutput = z.object({
  order: z.array(z.string().max(60)).min(1).max(30),
  notes: z.string().max(200),
});
export const DeliveryCheckOutput = z.object({
  matches_order: z.boolean(),
  confidence: z.number().min(0).max(1),
  issue: z.string().max(120).nullable(),
});
export const AGENT_OUTPUTS = {
  vision: VisionInspectionOutput,
  "delivery-verification": DeliveryCheckOutput,
  maintenance: MaintenanceOutput,
  inspection: InspectionPlanOutput,
  navigation: NavigationPlanOutput,
} as const;

export type AgentReceipt = {
  jobId: string;
  agentId: string;
  model: string;
  requestedTrustMode: string;
  trustEvidence: string;
  providerRequestId?: string;
  chatId?: string;
  providerAddress?: string;
  latencyMs: number;
  inputSha256: string;
  outputSha256: string;
  completedAt: string;
  /** Whose Router key paid for the inference (the agent's own capped key, or the shared platform key). */
  billing?: string;
  /** 0G inference cost the Router reported for this call, in neuron. */
  inferenceCostNeuron?: string;
  /** The robot's payment for this job (0G transfer hash), when a robot sent it. */
  paymentTx?: string;
  /** sha256 of this receipt's canonical JSON (fields above). Not signed: no keys in SEMMAL. */
  receiptHash: string;
};

export type AgentResult = {
  jobId: string;
  agentId: string;
  status: "succeeded" | "failed" | "rejected";
  reason?: string;
  output?: unknown;
  cost?: { amount: string; token: string };
  receipt?: AgentReceipt;
  evidenceRefs?: string[];
};

// ---------------------------------------------------------------- robot gateway (robot <-> platform)
/** Safety states from the robot's own supervisor (CLAUDE.md 4.4). The platform only reports them. */
export const SafetyState = z.enum(["NORMAL", "DEGRADED", "STOPPING", "E_STOP", "RECOVERY_REQUIRED"]);
const seq = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ts = z.string().datetime();

/** First message after connecting. The link token goes in the Authorization header, not here. */
export const GwHello = z.object({ type: z.literal("hello"), seq, ts, robotId: z.string().max(64), softwareVersion: z.string().max(32) });
export const GwHeartbeat = z.object({
  type: z.literal("heartbeat"),
  seq,
  ts,
  batteryPct: z.number().min(0).max(100),
  safetyState: SafetyState,
  /** Coarse zone only (an aisle or area name), never coordinates. */
  zone: z.string().max(40).optional(),
  availability: z.enum(["available", "busy", "offline"]),
});
export const GwMissionProgress = z.object({
  type: z.literal("mission_progress"),
  seq,
  ts,
  taskId: z.string().max(64),
  state: z.enum(["TASK_RECEIVED", "AWAITING_PAYMENT", "PAID", "VALIDATING", "PLANNING", "DISCOVERING_SPECIALISTS", "HIRING_SPECIALISTS", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "ABORTED", "PAUSED", "DEGRADED", "INCIDENT", "WAITING_FOR_0G", "SAFE_STOP"]),
  detail: z.string().max(200).optional(),
});
export const GwIncidentNotice = z.object({
  type: z.literal("incident_notice"),
  seq,
  ts,
  incidentId: z.string().max(64),
  faultCode: z.string().max(60),
  severity: z.enum(["info", "warning", "critical"]),
  safetyAction: z.string().max(40),
  persistence: z.enum(["LOCAL_DURABLE", "STORAGE_CONFIRMED", "ARKIV_CONFIRMED"]),
});
export const GwTaskAck = z.object({ type: z.literal("task_ack"), seq, ts, taskId: z.string().max(64), accepted: z.boolean(), reason: z.string().max(200).optional() });
export const RobotToPlatform = z.discriminatedUnion("type", [GwHello, GwHeartbeat, GwMissionProgress, GwIncidentNotice, GwTaskAck]);
export type RobotToPlatform = z.infer<typeof RobotToPlatform>;

export type PlatformToRobot =
  | { type: "welcome"; sessionId: string; serverTime: string; heartbeatSeconds: number }
  | { type: "ack"; seq: number }
  | { type: "error"; code: string; message: string; seq?: number }
  | { type: "task_assignment"; taskId: string; skill: string; plan: { waypoints: number; distanceM: number; privacy: string }; maxBudget?: string; deadline?: string; customerWallet?: string; assignedAt: string }
  | { type: "recovery_approval"; incidentId: string; approvedBy: string; approvedAt: string }
  /** The customer says they paid. The robot checks the transfer on chain itself before it starts. */
  | { type: "payment_notice"; taskId: string; txHash: string };

// ---------------------------------------------------------------- coordination + evidence on Arkiv
const addrZ = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amountZ = z.string().regex(/^\d+(\.\d{1,6})?$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** A customer's booking. Owned by the customer's wallet; expires at its deadline. */
export const TaskRequest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  taskId: z.string().regex(/^task-[a-z0-9-]{6,58}$/),
  customerWallet: addrZ,
  robotId: z.string().max(64),
  skill: RobotSkill,
  plan: z.object({ waypoints: z.number().int().min(1).max(50), distanceM: z.number().min(0).max(20000), privacy: TrustMode }),
  area: z.string().max(40),
  maxBudget: amountZ,
  deadline: z.string().datetime(),
  note: z.string().max(200).optional(),
});
export type TaskRequest = z.infer<typeof TaskRequest>;

/** The robot's offer for a task. Signed by the robot's device key; expires at validUntil. */
export const TaskQuote = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  quoteId: z.string().regex(/^quote-[a-z0-9-]{6,58}$/),
  taskId: z.string().max(64),
  robotId: z.string().max(64),
  robotWallet: addrZ,
  amount: amountZ,
  cost: amountZ,
  lines: z.array(z.object({ label: z.string().max(60), amount: z.string().max(20), source: z.string().max(20) })).max(12),
  validUntil: z.string().datetime(),
});
export type TaskQuote = z.infer<typeof TaskQuote>;

/** The robot hiring an agent for one job. Robot-signed; expires at the job deadline. */
export const JobClaim = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  jobId: z.string().max(64),
  taskId: z.string().max(64),
  robotId: z.string().max(64),
  robotWallet: addrZ,
  agentId: z.string().max(64),
  price: amountZ,
  deadline: z.string().datetime(),
});
export type JobClaim = z.infer<typeof JobClaim>;

/** One decision inside an episode: what 0G was asked, what came back, what the robot did. */
export const DecisionRecord = z.object({
  at: z.string().datetime(),
  checkpoint: z.string().max(60),
  agentId: z.string().max(64),
  providerRequestId: z.string().max(100).optional(),
  model: z.string().max(80),
  trustMode: z.string().max(20),
  latencyMs: z.number().int().min(0),
  outcome: z.enum(["accepted", "rejected", "failed", "timeout"]),
  action: z.string().max(60),
});

/** Arkiv index of an episode bundle stored on 0G Storage. Robot-signed. */
export const EpisodeIndex = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  episodeId: z.string().max(64),
  taskId: z.string().max(64),
  robotId: z.string().max(64),
  robotWallet: addrZ,
  outcome: z.enum(["COMPLETED", "FAILED", "ABORTED", "SAFE_STOP"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  storageRoot: hex32,
  manifestHash: hex32,
  robotSignature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(200),
  requestIds: z.array(z.string().max(100)).max(50),
  agents: z.array(z.string().max(64)).max(10),
  seqFrom: z.number().int().min(0),
  seqTo: z.number().int().min(0),
});
export type EpisodeIndex = z.infer<typeof EpisodeIndex>;

/** Arkiv index of an incident bundle stored on 0G Storage. Robot-signed. */
export const IncidentIndex = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  incidentId: z.string().max(64),
  robotId: z.string().max(64),
  robotWallet: addrZ,
  taskId: z.string().max(64).optional(),
  episodeId: z.string().max(64).optional(),
  faultCode: z.string().max(60),
  severity: z.enum(["info", "warning", "critical"]),
  safetyAction: z.string().max(40),
  detectedAt: z.string().datetime(),
  sequence: z.number().int().min(0),
  storageRoot: hex32,
  manifestHash: hex32,
  robotSignature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(200),
  requestIds: z.array(z.string().max(100)).max(20),
});
export type IncidentIndex = z.infer<typeof IncidentIndex>;
