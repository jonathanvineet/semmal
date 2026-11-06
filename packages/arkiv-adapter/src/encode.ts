/** Browser-safe: builds the exact Arkiv create arguments for a profile. No I/O, no keys. */
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, bool, dec, i32 } from "@arkiv-network/sdk/schema";
import { AgentListing, RobotProfile, type AgentListing as TAgent, type RobotProfile as TRobot } from "@semmal/contracts";
import { AgentProfileSchema, RobotProfileSchema } from "./schemas";

/** Canonical JSON: stable key order so the same profile always encodes to the same bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

/**
 * How long a registration (robot profile, agent listing) stays on Arkiv: 3 months. Rabdi allows up
 * to MAX_LIFETIME = 7,884,000 blocks (about 182 days at 2 s per block, SDK 1.0.1); re-publish or extend
 * before it lapses.
 */
export const REGISTRATION_DAYS = 90;

export function robotCreateArgs(input: TRobot, ttlDays = REGISTRATION_DAYS) {
  const p = RobotProfile.parse(input);
  const has = (c: string) => bool(p.capabilities.includes(c as TRobot["capabilities"][number]));
  return {
    schema: RobotProfileSchema,
    values: {
      robot_id: p.robotId,
      robot_wallet: addr(p.robotWallet),
      owner_wallet: addr(p.ownerWallet),
      model: p.model,
      robot_type: p.robotType,
      service_area: p.serviceArea,
      can_inspect: has("warehouse.inspection"),
      can_patrol: has("warehouse.patrol"),
      can_deliver: has("indoor.delivery"),
      ...Object.fromEntries(p.capabilities.slice(0, 4).map((c, i) => [`skill_${i + 1}`, c])),
      // indexed "from" price for sorting: the owner's minimum fee (legacy profiles: their fixed price)
      price: dec(p.pricing?.minFee ?? p.price!.amount),
      profile_version: i32(p.profileVersion),
      display_name: p.displayName,
      profile: new TextEncoder().encode(canonicalJson(p)),
    },
    options: { expiration: ExpirationTime.fromDays(ttlDays) },
  };
}

export function agentCreateArgs(input: TAgent, ttlDays = REGISTRATION_DAYS) {
  const a = AgentListing.parse(input);
  return {
    schema: AgentProfileSchema,
    values: {
      agent_id: a.agentId,
      owner_wallet: addr(a.ownerWallet),
      kind: a.kind,
      primary_capability: a.capabilities[0]!.capabilityId,
      trust_mode: a.inference?.trustMode ?? "none",
      price: dec(a.price.amount),
      display_name: a.displayName,
      listing: new TextEncoder().encode(canonicalJson(a)),
    },
    options: { expiration: ExpirationTime.fromDays(ttlDays) },
  };
}

// ---------------------------------------------------------------- coordination + evidence encoders
import { EpisodeIndex, IncidentIndex, JobClaim, ReputationCheckpoint, SCORE_RULES, TaskQuote, TaskRequest } from "@semmal/contracts";
import { addr as addrV, dec as decV, i32 as i32V, u64 } from "@arkiv-network/sdk/schema";
import { EpisodeSchema, IncidentSchema, JobClaimSchema, QuoteSchema, ReputationSchema, TaskRequestSchema } from "./schemas";

const BLOCK_SECONDS = 2;
/** Lifetime that ends at `iso` (rounded up to the 2 s block time, at least 2 blocks). */
export function expiresAt(iso: string, now = Date.now()) {
  const secs = Math.max(2 * BLOCK_SECONDS, Math.ceil((Date.parse(iso) - now) / 1000));
  return ExpirationTime.fromSeconds(Math.ceil(secs / BLOCK_SECONDS) * BLOCK_SECONDS);
}
const body = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const EVIDENCE_DAYS = 120; // about 4 months; renew before expiry if longer retention is needed // renew before expiry if longer retention is needed (Lifetime Extension)

export function taskRequestCreateArgs(input: TaskRequest) {
  const t = TaskRequest.parse(input);
  return {
    schema: TaskRequestSchema,
    values: { task_id: t.taskId, robot_id: t.robotId, skill: t.skill, area: t.area, customer: addrV(t.customerWallet), max_budget: decV(t.maxBudget), body: body(t) },
    options: { expiration: expiresAt(t.deadline) },
  };
}

export function quoteCreateArgs(input: TaskQuote) {
  const q = TaskQuote.parse(input);
  return {
    schema: QuoteSchema,
    values: { quote_id: q.quoteId, task_id: q.taskId, robot_id: q.robotId, amount: decV(q.amount), body: body(q) },
    options: { expiration: expiresAt(q.validUntil) },
  };
}

export function jobClaimCreateArgs(input: JobClaim) {
  const c = JobClaim.parse(input);
  return {
    schema: JobClaimSchema,
    values: { job_id: c.jobId, task_id: c.taskId, robot_id: c.robotId, agent_id: c.agentId, body: body(c) },
    options: { expiration: expiresAt(c.deadline) },
  };
}

export function episodeCreateArgs(input: EpisodeIndex) {
  const e = EpisodeIndex.parse(input);
  return {
    schema: EpisodeSchema,
    values: { episode_id: e.episodeId, task_id: e.taskId, robot_id: e.robotId, outcome: e.outcome, storage_root: e.storageRoot, ended_at: u64(BigInt(Math.floor(Date.parse(e.endedAt) / 1000))), body: body(e) },
    options: { expiration: ExpirationTime.fromDays(EVIDENCE_DAYS) },
  };
}

export function incidentCreateArgs(input: IncidentIndex) {
  const i = IncidentIndex.parse(input);
  return {
    schema: IncidentSchema,
    values: { incident_id: i.incidentId, robot_id: i.robotId, fault_code: i.faultCode, severity: i.severity, storage_root: i.storageRoot, sequence: u64(BigInt(i.sequence)), body: body(i) },
    options: { expiration: ExpirationTime.fromDays(EVIDENCE_DAYS) },
  };
}

/** A score checkpoint: about 4 months on Arkiv; publishing a newer one refreshes the record. */
export function reputationCreateArgs(input: ReputationCheckpoint) {
  const r = ReputationCheckpoint.parse(input);
  return {
    schema: ReputationSchema,
    values: { subject_kind: r.subjectKind, subject_id: r.subjectId, score: i32V(r.score), status: r.status, body: body(r) },
    options: { expiration: ExpirationTime.fromDays(SCORE_RULES.checkpointDays) },
  };
}
