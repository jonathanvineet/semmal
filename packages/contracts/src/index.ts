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
] as const;
export const RobotSkill = z.enum([
  "warehouse.inspection", "warehouse.patrol", "indoor.delivery", "aerial.inspection", "aerial.mapping",
  "site.inspection", "outdoor.patrol", "manipulation.pick-place", "manipulation.assembly",
  "manipulation.machine-tending", "manipulation.dexterous", "assist.human",
]);

const SENSORS = ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery", "depth-camera", "gps", "barometer", "joint-encoders", "force-torque", "tactile"] as const;
export const Sensor = z.enum(SENSORS);

/**
 * Robot types SEMMAL can register. `asset` is the 3D model in apps/web/public/models (adapted
 * from MuJoCo Menagerie; see /credits).
 */
export const ROBOT_MODELS = [
  { id: "rover", name: "Compact rover", robotType: "diff-drive-indoor", asset: "rover", base: "Wheeled indoor base", sensors: ["lidar-2d", "rgb-camera", "imu", "wheel-encoders", "bumper", "battery"], skills: ["warehouse.inspection", "warehouse.patrol", "indoor.delivery"], note: "Small wheeled base for aisles, patrols and short deliveries." },
  { id: "drone", name: "Inspection drone", robotType: "aerial-multirotor", asset: "drone", base: "Quadcopter", sensors: ["rgb-camera", "imu", "gps", "barometer", "battery"], skills: ["aerial.inspection", "aerial.mapping"], note: "Flies to high or hard-to-reach places and maps sites." },
  { id: "quadruped", name: "Quadruped", robotType: "legged-quadruped", asset: "quadruped", base: "Four-legged base", sensors: ["depth-camera", "lidar-2d", "imu", "joint-encoders", "battery"], skills: ["site.inspection", "outdoor.patrol", "warehouse.patrol"], note: "Walks stairs and rough ground where wheels cannot go." },
  { id: "arm", name: "Robot arm", robotType: "fixed-arm", asset: "arm", base: "Six-axis arm", sensors: ["joint-encoders", "force-torque", "rgb-camera"], skills: ["manipulation.pick-place", "manipulation.assembly", "manipulation.machine-tending"], note: "Fixed six-axis arm for cells, benches and machines." },
  { id: "hand", name: "Dexterous hand", robotType: "dexterous-hand", asset: "hand", base: "Five-finger hand", sensors: ["joint-encoders", "tactile"], skills: ["manipulation.dexterous", "manipulation.assembly"], note: "Five fingers for small, delicate or oddly shaped parts." },
  { id: "humanoid", name: "Humanoid", robotType: "humanoid", asset: "humanoid", base: "Bipedal humanoid", sensors: ["depth-camera", "imu", "joint-encoders", "force-torque", "battery"], skills: ["manipulation.pick-place", "indoor.delivery", "assist.human"], note: "Works in spaces built for people, next to people." },
  { id: "manipulator", name: "Mobile manipulator", robotType: "mobile-manipulator", asset: "manipulator", base: "Wheeled base with an arm", sensors: ["lidar-2d", "depth-camera", "imu", "joint-encoders", "battery"], skills: ["manipulation.pick-place", "indoor.delivery", "warehouse.inspection"], note: "Drives to the job, then picks and places." },
] as const;
/** Older ids stay valid so profiles already on Arkiv still parse. */
export const RobotModelId = z.enum(["rover", "drone", "quadruped", "arm", "hand", "humanoid", "manipulator", "semmal-rover-sim", "custom-diff-drive"]);

/** The robot's unique id, derived from its own wallet so one robot cannot hold two ids. */
export const robotIdFromWallet = (wallet: string) => `rbt-${wallet.toLowerCase().replace(/^0x/, "").slice(0, 10)}`;

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
  /** Pricing the robot charges a customer. */
  price: z.object({ amount: decimalAmount, token: z.string().max(12), unit: z.enum(["task", "hour"]) }),
});
export type RobotProfile = z.infer<typeof RobotProfile>;

// ---------------------------------------------------------------- agents
export const AgentKind = z.enum(["vision", "inspection", "maintenance", "navigation", "delivery-verification"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const Capability = z.object({
  capabilityId: z.string().max(64).regex(/^[a-z]+(\.[a-z-]+)+$/),
  inputSchemaVersion: z.string().max(16),
  outputSchemaVersion: z.string().max(16),
  supportedRobotTypes: z.array(RobotType).min(1).max(4),
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
