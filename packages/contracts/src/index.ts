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
export const RobotModelId = z.enum(["create3", "turtlebot4", "jackal", "rover", "cleaner", "field-rover", "drone", "quadruped", "arm", "hand", "humanoid", "manipulator", "semmal-rover-sim", "custom-diff-drive"]);

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

// ---------------------------------------------------------------- supported hardware + device identity
/**
 * The hardware SEMMAL supports: real, customisable ROS 2 robots. A robot is registered by connecting
 * to it: its identity node reports what it is (facts) and its device identity service signs a fresh
 * challenge with the robot's own key. The platform decides the model from the facts with
 * `detectHardware`; it never takes the robot's word alone.
 *
 * runtime "gazebo": the robot runs in Gazebo on a PC, as a stand-in for this hardware during
 * development. It must load the matching robot description (body) with the expected sensors.
 * runtime "hardware": the real robot. Its on-board evidence rule has not been tested yet, so it is
 * not accepted until it is.
 */
export const HARDWARE = [
  {
    id: "create3", name: "iRobot Create 3", maker: "iRobot Education", robotType: "diff-drive-indoor", asset: "rover", body: "cleaner",
    base: "Create 3 base with a camera and 2D lidar added", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery"],
    expectSensors: ["camera", "gpu_lidar", "imu"],
    skills: ["home.cleaning", "indoor.delivery"],
    note: "Round home robot base with native ROS 2. Visits rooms, spots spills and clutter.",
  },
  {
    id: "turtlebot4", name: "TurtleBot 4", maker: "Clearpath Robotics", robotType: "diff-drive-indoor", asset: "rover", body: "rover",
    base: "Create 3 base, Raspberry Pi 4, OAK-D camera, 2D lidar", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery"],
    expectSensors: ["camera", "gpu_lidar", "imu"],
    skills: ["warehouse.inspection", "warehouse.patrol", "indoor.delivery"],
    note: "Open ROS 2 mobile robot. Inspects panels and patrols aisles.",
  },
  {
    id: "jackal", name: "Jackal UGV", maker: "Clearpath Robotics", robotType: "diff-drive-outdoor", asset: "rover", body: "field",
    base: "Rugged all-terrain base with camera, 2D lidar and GPS", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "gps", "battery"],
    expectSensors: ["camera", "gpu_lidar", "imu"],
    skills: ["outdoor.patrol", "site.inspection"],
    note: "Outdoor ROS 2 robot for trails and sites. Patrols and reports hazards.",
  },
] as const;
export type HardwareId = (typeof HARDWARE)[number]["id"];

/** What a robot reports about itself. Short strings only; no serial numbers, hostnames or locations. */
export const HardwareFacts = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), z.string().max(160)).refine((f) => Object.keys(f).length <= 24, { message: "at most 24 facts" });
export type HardwareFacts = z.infer<typeof HardwareFacts>;

export type HardwareCheck = { ok: true; model: HardwareId; runtime: "gazebo" | "hardware" } | { ok: false; reason: string };

/** Which supported hardware the signed facts describe. Pure; the platform runs it, not the robot. */
export function detectHardware(f: HardwareFacts): HardwareCheck {
  const hw = HARDWARE.find((h) => h.id === f.model);
  if (!hw) return { ok: false, reason: `${f.model ? `"${f.model}" is not` : "no model is"} a supported robot` };
  if (f.runtime === "hardware") return { ok: false, reason: `on-board checks for a real ${hw.name} are not tested yet; it cannot be registered as hardware` };
  if (f.runtime !== "gazebo") return { ok: false, reason: "unknown runtime" };
  if (f.body !== hw.body) return { ok: false, reason: `the loaded robot description is "${f.body ?? "none"}", not the ${hw.name} body` };
  if (!f.description) return { ok: false, reason: "no robot description is loaded; is the robot stack running?" };
  const have = new Set((f.sensors ?? "").split(",").filter(Boolean));
  const missing = hw.expectSensors.filter((s) => !have.has(s));
  if (missing.length) return { ok: false, reason: `the loaded description lacks ${missing.join(", ")}` };
  return { ok: true, model: hw.id, runtime: "gazebo" };
}

/** The robot's answer to a connect challenge, signed (EIP-191) by its device key. */
export const RobotIdentity = z.object({
  schema: z.literal("semmal-robot-identity-v1"),
  wallet: evmAddress,
  hardwareModel: z.string().max(40),
  facts: HardwareFacts,
  /** sha256 over the canonical JSON of `facts` (0x-hex). */
  factsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9]{16,64}$/),
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
export type RobotIdentity = z.infer<typeof RobotIdentity>;

/** The exact text the robot signs. Anyone can rebuild it from a stored attestation and check the signature. */
export const identityMessage = (d: { wallet: string; hardwareModel: string; factsHash: string; nonce: string; issuedAt: string }) =>
  `SEMMAL robot identity\nwallet: ${d.wallet}\nhardware: ${d.hardwareModel}\nfactsHash: ${d.factsHash}\nnonce: ${d.nonce}\nissuedAt: ${d.issuedAt}`;

/** Stable JSON: object keys sorted at every level. */
export const canonicalFacts = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// ---------------------------------------------------------------- location
/** Coarse position for public records: two decimals (about 1 km). Exact positions never go to Arkiv. */
export const coarse = (v: number) => Math.round(v * 100) / 100;
export const CoarseLocation = z.object({
  lat: z.number().min(-90).max(90).refine((v) => coarse(v) === v, "at most 2 decimals (about 1 km)"),
  lon: z.number().min(-180).max(180).refine((v) => coarse(v) === v, "at most 2 decimals (about 1 km)"),
});
export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type LatLon = z.infer<typeof LatLon>;

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
  /** Where the robot is based, to about 1 km, as the robot reported it when it was connected. */
  location: CoarseLocation.optional(),
  /** How far from its base the robot will travel for a job. */
  serviceRadiusKm: z.number().min(1).max(500).optional(),
  /** The owner's limits; the robot quotes each task inside them. */
  pricing: PricingPolicy.optional(),
  /** The signed connect challenge from registration: proves the robot wallet's key was on the device that reported these facts. */
  attestation: RobotIdentity.omit({ schema: true }).optional(),
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
  recommended_action: z.enum(["continue_mission", "clear_and_continue", "pause_and_request_inspection", "return_to_dock", "abort_mission"]),
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
  /** Machine-readable cause of a failed 0G call (0G Router error code, e.g. no_provider_for_trust_mode). */
  code?: string;
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
  state: z.enum(["TASK_RECEIVED", "AWAITING_OWNER", "APPROVED", "AWAITING_CONFIRMATION", "CONFIRMED", "AWAITING_PAYMENT", "PAID", "TRAVELLING", "ARRIVED", "VALIDATING", "PLANNING", "DISCOVERING_SPECIALISTS", "HIRING_SPECIALISTS", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "ABORTED", "PAUSED", "DEGRADED", "INCIDENT", "WAITING_FOR_0G", "SAFE_STOP"]),
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
/** The robot's position while it travels to a job. Live only: kept by the platform, never on Arkiv. */
export const GwPosition = z.object({
  type: z.literal("position"),
  seq,
  ts,
  taskId: z.string().max(64),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  phase: z.enum(["WAITING", "TRAVELLING", "ARRIVED"]),
  etaAt: z.string().datetime().optional(),
  remainingM: z.number().min(0).max(1_000_000).optional(),
});
/** The robot's offer, sent straight to the platform so the customer can pay without waiting for Arkiv. */
export const GwOffer = z.object({
  type: z.literal("offer"),
  seq,
  ts,
  taskId: z.string().max(64),
  quoteId: z.string().regex(/^quote-[a-z0-9-]{6,58}$/),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  validUntil: z.string().datetime(),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
/** One 0G decision in full, for the customer's "how it decided" view. Never the image or prompt bytes. */
export const GwDecision = z.object({
  type: z.literal("decision"),
  seq,
  ts,
  taskId: z.string().max(64),
  detail: z.record(z.string(), z.unknown()).refine((d) => JSON.stringify(d).length <= 8000, "decision too large"),
});
export const GwTaskAck = z.object({ type: z.literal("task_ack"), seq, ts, taskId: z.string().max(64), accepted: z.boolean(), reason: z.string().max(200).optional() });
/** The robot's answer to the owner's "release hold": it decides itself, from its own local state. */
export const GwHoldResult = z.object({ type: z.literal("hold_result"), seq, ts, released: z.boolean(), reason: z.string().max(200).optional() });
/** The robot's answer to a customer's extra request during a job: it decides itself. */
export const GwExtraResult = z.object({
  type: z.literal("extra_result"), seq, ts, taskId: z.string().max(64), extraId: z.string().max(64), stop: z.string().max(64),
  accepted: z.boolean(), reason: z.string().max(200),
});
export const RobotToPlatform = z.discriminatedUnion("type", [GwHello, GwHeartbeat, GwMissionProgress, GwIncidentNotice, GwTaskAck, GwPosition, GwOffer, GwDecision, GwHoldResult, GwExtraResult]);
export type RobotToPlatform = z.infer<typeof RobotToPlatform>;

export type PlatformToRobot =
  | { type: "welcome"; sessionId: string; serverTime: string; heartbeatSeconds: number }
  | { type: "ack"; seq: number }
  | { type: "error"; code: string; message: string; seq?: number }
  | {
      type: "task_assignment"; taskId: string; skill: string; plan: { waypoints: number; distanceM: number; privacy: string };
      maxBudget?: string; deadline?: string; customerWallet?: string; assignedAt: string;
      /** The customer's site (exact; only the robot and the platform see it) and when to be there. */
      site?: { lat: number; lon: number }; startAt?: string;
    }
  | { type: "recovery_approval"; incidentId: string; approvedBy: string; approvedAt: string }
  /** The customer says they paid. The robot checks the transfer on chain itself before it starts. */
  | { type: "payment_notice"; taskId: string; txHash: string }
  /** The robot's owner approved or declined a booking (checked as the owner wallet by the platform). */
  | { type: "owner_decision"; taskId: string; approved: boolean; reason?: string }
  /** The customer confirmed the robot is on site (checked as the booking's wallet by the platform). */
  | { type: "arrival_confirmed"; taskId: string }
  /** Development (APP_MODE=simulation): leave now and finish the trip in a few seconds. */
  | { type: "fast_forward"; taskId: string }
  /** The customer asks for one more stop during the job (checked as the booking's wallet). The robot decides. */
  | { type: "task_extra"; taskId: string; extraId: string; stop: string; requestedAt: string }
  /**
   * The owner asks the robot to end a soft hold (e.g. after a SAFE_STOP). Advisory: the robot releases only
   * when no task or mission is running and the hold is the only thing stopping it. It never clears an
   * emergency stop; that needs the operator on the robot (/safety/request_recovery).
   */
  | { type: "release_hold"; requestedBy: string; requestedAt: string };

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
  /** When the customer booked it. */
  createdAt: z.string().datetime().optional(),
  /** When the customer wants the robot on site (the delivery date). The address itself is never on Arkiv. */
  startAt: z.string().datetime().optional(),
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
  /** The robot's score for each agent job it paid for in this episode (agent-job-score-v1). */
  agentJobs: z.array(z.object({ agentId: z.string().max(64), at: z.string().datetime(), status: z.enum(["succeeded", "failed"]), score: z.number().int().min(0).max(100) })).max(30).optional(),
  /** The robot's own score for this job (task-score-v1), the same object that is in the signed bundle. */
  score: z.lazy(() => TaskScore).optional(),
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

/**
 * The places a robot visits for each kind of job, in its preference order (only those its world has).
 * A customer can ask for one of these as an extra stop during a job; the robot decides.
 */
export const SKILL_STOPS: Record<string, readonly string[]> = {
  "warehouse.inspection": ["inspection_point_A"],
  "site.inspection": ["inspection_point_A", "log_check"],
  "aerial.inspection": ["inspection_point_A"],
  "warehouse.patrol": ["inspection_point_A", "destination"],
  "indoor.delivery": ["destination", "kitchen"],
  "home.cleaning": ["kitchen", "living_room", "bedroom", "bathroom", "office", "guest_room"],
  "outdoor.patrol": ["creek_crossing", "log_check", "fire_lookout"],
};

// ---------------------------------------------------------------- job score (task-score-v1)
/**
 * The robot scores each job it finishes, from its own episode, before it signs and stores it. Every part
 * shows its inputs; parts that do not apply to a job are "not judged" and leave the total:
 *
 *   completion   40  stops visited / stops planned (customer extras it accepted count as planned)
 *   decisions    20  0G answers that passed the robot's checks / 0G answers it asked for
 *   findings     20  findings it dealt with / findings (cleared, reported, or held for inspection as the job says)
 *   extras       10  extras done / extras it accepted                      (not judged without extras)
 *   on time      10  finished by the booking's deadline                      (not judged without a deadline)
 *
 *   score = round(100 * points / max of the judged parts)
 *
 * A safe stop is the right behaviour, never misconduct: on SAFE_STOP only the decisions part is judged.
 */
export const TASK_SCORE_FORMULA = "task-score-v1" as const;
export const TASK_SCORE_WEIGHTS = { completion: 40, decisions: 20, findings: 20, extras: 10, onTime: 10 } as const;
export const TaskScorePart = z.object({
  id: z.enum(["completion", "decisions", "findings", "extras", "onTime"]),
  label: z.string().max(40),
  judged: z.boolean(),
  points: z.number().int().min(0).max(100),
  max: z.number().int().min(0).max(100),
  detail: z.string().max(160),
});
export const TaskScore = z.object({
  formula: z.literal(TASK_SCORE_FORMULA),
  score: z.number().int().min(0).max(100),
  points: z.number().int().min(0).max(100),
  max: z.number().int().min(0).max(100),
  parts: z.array(TaskScorePart).max(5),
});
export type TaskScore = z.infer<typeof TaskScore>;
export type TaskScoreInput = {
  outcome: "COMPLETED" | "FAILED" | "ABORTED" | "SAFE_STOP";
  planned: number; visited: number;
  decisionsAsked: number; decisionsAccepted: number;
  findings: number; findingsHandled: number;
  extrasAccepted: number; extrasDone: number;
  deadline?: string | null; endedAt: string;
};

export function scoreTask(i: TaskScoreInput): TaskScore {
  const W = TASK_SCORE_WEIGHTS;
  const safe = i.outcome === "SAFE_STOP";
  const ratio = (n: number, d: number) => (d > 0 ? Math.max(0, Math.min(1, n / d)) : 1);
  const part = (id: z.infer<typeof TaskScorePart>["id"], label: string, max: number, judged: boolean, r: number, detail: string) =>
    ({ id, label, judged, max: judged ? max : 0, points: judged ? Math.round(max * r) : 0, detail });
  const parts = [
    part("completion", "Stops completed", W.completion, !safe && i.planned > 0, ratio(i.visited, i.planned), safe ? "not judged: a safe stop is the right behaviour" : `${i.visited} of ${i.planned} stops`),
    part("decisions", "Valid 0G decisions", W.decisions, i.decisionsAsked > 0, ratio(i.decisionsAccepted, i.decisionsAsked), i.decisionsAsked ? `${i.decisionsAccepted} of ${i.decisionsAsked} answers passed the robot's checks` : "not judged: no 0G answers asked for"),
    part("findings", "Findings dealt with", W.findings, !safe && i.findings > 0, ratio(i.findingsHandled, i.findings), safe ? "not judged: safe stop" : i.findings ? `${i.findingsHandled} of ${i.findings} findings` : "not judged: nothing found"),
    part("extras", "Extra stops done", W.extras, !safe && i.extrasAccepted > 0, ratio(i.extrasDone, i.extrasAccepted), safe ? "not judged: safe stop" : i.extrasAccepted ? `${i.extrasDone} of ${i.extrasAccepted} accepted extras` : "not judged: no extras accepted"),
    part("onTime", "On time", W.onTime, !safe && Boolean(i.deadline), i.deadline && Date.parse(i.endedAt) <= Date.parse(i.deadline) ? 1 : 0, safe ? "not judged: safe stop" : i.deadline ? `finished ${Date.parse(i.endedAt) <= Date.parse(i.deadline) ? "before" : "after"} the deadline ${i.deadline}` : "not judged: no deadline"),
  ];
  const points = parts.reduce((t, p) => t + p.points, 0);
  const max = parts.reduce((t, p) => t + p.max, 0);
  return { formula: TASK_SCORE_FORMULA, score: max ? Math.round((100 * points) / max) : 100, points, max, parts };
}

// ---------------------------------------------------------------- agent job score (agent-job-score-v1)
/**
 * The hiring robot scores every agent job it paid for, from what it saw itself:
 *
 *   delivered     40  the agent returned an answer before the deadline
 *   passed checks 40  the answer passed the robot's checks (format, allowed action, confidence / a usable plan)
 *   speed         20  20 if it answered within half the deadline, 10 within the deadline, else 0
 *
 * A job that never ran because of the robot (not paid, over its budget) is not judged: not the agent's fault.
 */
export const AGENT_JOB_SCORE_FORMULA = "agent-job-score-v1" as const;
export const AgentJobScore = z.object({
  formula: z.literal(AGENT_JOB_SCORE_FORMULA),
  score: z.number().int().min(0).max(100),
  parts: z.array(z.object({ id: z.enum(["delivered", "checks", "speed"]), label: z.string().max(40), points: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100), detail: z.string().max(120) })).max(3),
});
export type AgentJobScore = z.infer<typeof AgentJobScore>;
export function scoreAgentJob(i: { delivered: boolean; passedChecks: boolean; latencyMs: number; deadlineMs: number }): AgentJobScore {
  const speed = !i.delivered ? 0 : i.latencyMs <= i.deadlineMs / 2 ? 20 : i.latencyMs <= i.deadlineMs ? 10 : 0;
  const parts = [
    { id: "delivered" as const, label: "Delivered", points: i.delivered ? 40 : 0, max: 40, detail: i.delivered ? "answered before the deadline" : "no answer before the deadline" },
    { id: "checks" as const, label: "Passed the robot's checks", points: i.delivered && i.passedChecks ? 40 : 0, max: 40, detail: !i.delivered ? "nothing to check" : i.passedChecks ? "format, action and confidence accepted" : "rejected by the robot's checks" },
    { id: "speed" as const, label: "Speed", points: speed, max: 20, detail: i.delivered ? `${i.latencyMs} ms of a ${i.deadlineMs} ms deadline` : "no answer" },
  ];
  return { formula: AGENT_JOB_SCORE_FORMULA, score: parts.reduce((t, p) => t + p.points, 0), parts };
}

// ---------------------------------------------------------------- reputation (score-v2)
/**
 * Performance scores for robots and agents. Deterministic and published (formula "score-v1"):
 *
 *  Robot (from its robot-signed Arkiv episodes and incidents):
 *    judged     = completed + failed episodes   (safe stops and aborts are not counted against it:
 *                                                a correct safe stop is the right behaviour)
 *    job score  = the episode's own task-score-v1 score; an older episode without one counts 100 if
 *                 completed and 0 if failed
 *    score      = round(mean job score of judged episodes - 20 * min(1, incidents / episodes))
 *  Agent (from the job scores the hiring robots wrote into their signed episodes on Arkiv; an agent no
 *  robot has scored yet falls back to the runner's record of each paid job):
 *    judged     = succeeded + failed jobs       (jobs that never ran because of the robot are not judged)
 *    job score  = the robot's agent-job-score-v1 score; a runner-only job counts 100 if it succeeded, 0 if not
 *    score      = round(mean job score of judged jobs)
 *
 *  Selection (who gets booked, who gets hired): the score blended with a neutral prior so one lucky job does
 *  not beat a long record, and a new robot or agent is not buried:
 *    selection  = round((judged * score + 3 * 70) / (judged + 3))       (excluded: never selected)
 *  Status: "new" under 3 judged jobs; "excluded" with >= 5 judged and score < 40, or no activity for
 *  180 days; "watch" under 60; otherwise "good". Excluded robots and agents are left out of discovery
 *  and hiring.
 */
export const SCORE_FORMULA = "score-v2" as const;
export const SCORE_RULES = { minJudged: 3, excludeMinJudged: 5, excludeBelow: 40, watchBelow: 60, inactiveDays: 180, checkpointDays: 120 } as const;
export type ScoreStatus = "new" | "good" | "watch" | "excluded";
export type Score = { score: number; status: ScoreStatus; judged: number; counts: Record<string, number>; lastActiveAt: string | null; reason: string };

function status(score: number, judged: number, lastActiveAt: string | null, now: number): { status: ScoreStatus; reason: string } {
  const idle = lastActiveAt ? (now - Date.parse(lastActiveAt)) / 86_400_000 : null;
  if (idle !== null && idle > SCORE_RULES.inactiveDays) return { status: "excluded", reason: `no activity for ${Math.floor(idle)} days` };
  if (judged >= SCORE_RULES.excludeMinJudged && score < SCORE_RULES.excludeBelow) return { status: "excluded", reason: `score ${score} after ${judged} judged jobs` };
  if (judged < SCORE_RULES.minJudged) return { status: "new", reason: `${judged} judged job${judged === 1 ? "" : "s"} so far` };
  if (score < SCORE_RULES.watchBelow) return { status: "watch", reason: `score ${score}` };
  return { status: "good", reason: `score ${score}` };
}

export function scoreRobot(episodes: { outcome: string; endedAt: string; score?: { score: number } }[], incidents: { detectedAt: string }[], now = Date.now()): Score {
  const c = { episodes: episodes.length, completed: 0, failed: 0, safeStops: 0, aborted: 0, incidents: incidents.length, scored: 0 };
  const jobScores: number[] = [];
  for (const e of episodes) {
    if (e.outcome === "COMPLETED") c.completed++;
    else if (e.outcome === "FAILED") c.failed++;
    else if (e.outcome === "SAFE_STOP") c.safeStops++;
    else c.aborted++;
    if (e.outcome === "COMPLETED" || e.outcome === "FAILED") {
      if (e.score) c.scored++;
      jobScores.push(e.score ? e.score.score : e.outcome === "COMPLETED" ? 100 : 0);
    }
  }
  const judged = c.completed + c.failed;
  const base = judged ? jobScores.reduce((t, x) => t + x, 0) / judged : 100;
  const score = Math.max(0, Math.min(100, Math.round(base - 20 * Math.min(1, c.episodes ? c.incidents / c.episodes : 0))));
  const times = [...episodes.map((e) => e.endedAt), ...incidents.map((i) => i.detectedAt)].filter(Boolean).sort();
  const lastActiveAt = times.at(-1) ?? null;
  return { score, judged, counts: c, lastActiveAt, ...status(score, judged, lastActiveAt, now) };
}

export function scoreAgent(jobs: { status: string; at: string; score?: { score: number } }[], now = Date.now()): Score {
  const c = { jobs: jobs.length, succeeded: 0, failed: 0, rejected: 0, scored: 0 };
  const jobScores: number[] = [];
  for (const j of jobs) {
    if (j.status === "succeeded") c.succeeded++;
    else if (j.status === "failed") c.failed++;
    else c.rejected++;
    if (j.status === "succeeded" || j.status === "failed") {
      if (j.score) c.scored++;
      jobScores.push(j.score ? j.score.score : j.status === "succeeded" ? 100 : 0);
    }
  }
  const judged = c.succeeded + c.failed;
  const score = judged ? Math.round(jobScores.reduce((t, x) => t + x, 0) / judged) : 100;
  const lastActiveAt = jobs.map((j) => j.at).sort().at(-1) ?? null;
  return { score, judged, counts: c, lastActiveAt, ...status(score, judged, lastActiveAt, now) };
}

export const SELECTION_PRIOR = { score: 70, weight: 3, band: 5 } as const;
/** The score used to choose robots and agents: the reputation pulled toward 70 while there is little evidence. */
export function selectionScore(s: Pick<Score, "score" | "judged" | "status">): number | null {
  if (s.status === "excluded") return null;
  return Math.round((s.judged * s.score + SELECTION_PRIOR.weight * SELECTION_PRIOR.score) / (s.judged + SELECTION_PRIOR.weight));
}

/** A published score checkpoint. Written by the instance owner's wallet; lives 120 days unless refreshed. */
export const ReputationCheckpoint = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  formula: z.enum(["score-v1", SCORE_FORMULA]),
  subjectKind: z.enum(["robot", "agent"]),
  subjectId: z.string().min(3).max(64),
  score: z.number().int().min(0).max(100),
  status: z.enum(["new", "good", "watch", "excluded"]),
  judged: z.number().int().min(0),
  counts: z.record(z.string().max(20), z.number().int().min(0)),
  lastActiveAt: z.string().datetime().nullable(),
  computedAt: z.string().datetime(),
  publisherWallet: addrZ,
});
export type ReputationCheckpoint = z.infer<typeof ReputationCheckpoint>;
