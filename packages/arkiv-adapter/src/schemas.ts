/**
 * Arkiv entity schemas (SDK @arkiv-network/sdk 1.0.1, verified against installed source).
 * Only columns we filter or sort on are indexed. Full profiles go in a bytes() column as
 * canonical JSON (public data only, never secrets, live location or customer data).
 * str() columns hold at most 128 UTF-8 bytes; bytes() at most 128 KiB per create.
 */
import { addr, bool, bytes, dec, defineSchema, i32, str, u64 } from "@arkiv-network/sdk/schema";

export const RobotProfileSchema = defineSchema("semmal_robot_profile_v2", {
  robot_id: str().indexed(),
  robot_wallet: addr().indexed(),
  // the registering wallet; also Arkiv's own $owner. Indexed for "robots owned by X".
  owner_wallet: addr().indexed(),
  model: str().indexed(),
  robot_type: str().indexed(),
  service_area: str().indexed(),
  // one flag per skill, so "robots that can patrol" is an indexed query (arrays are not indexable)
  can_inspect: bool().indexed(),
  can_patrol: bool().indexed(),
  can_deliver: bool().indexed(),
  // up to four skills, one indexed slot each, so any skill is a single eq() or an or() of four
  skill_1: str().indexed().optional(),
  skill_2: str().indexed().optional(),
  skill_3: str().indexed().optional(),
  skill_4: str().indexed().optional(),
  price: dec().indexed(),
  profile_version: i32().indexed(),
  display_name: str(),
  profile: bytes(),
});

export const AgentProfileSchema = defineSchema("semmal_agent_profile_v2", {
  agent_id: str().indexed(),
  owner_wallet: addr().indexed(),
  kind: str().indexed(),
  primary_capability: str().indexed(),
  trust_mode: str().indexed(),
  price: dec().indexed(),
  display_name: str(),
  listing: bytes(),
});

// ---------------------------------------------------------------- coordination (expiring) + evidence
/** A customer's booking. Owner: customer wallet. Expires at the task deadline. */
export const TaskRequestSchema = defineSchema("semmal_task_request_v1", {
  task_id: str().indexed(),
  robot_id: str().indexed(),
  skill: str().indexed(),
  area: str().indexed(),
  customer: addr().indexed(),
  max_budget: dec().indexed(),
  body: bytes(),
});

/** A robot's offer. Owner: robot wallet. Expires when the offer lapses. */
export const QuoteSchema = defineSchema("semmal_quote_v1", {
  quote_id: str().indexed(),
  task_id: str().indexed(),
  robot_id: str().indexed(),
  amount: dec().indexed(),
  body: bytes(),
});

/** A robot hiring an agent for one job. Owner: robot wallet. Expires at the job deadline. */
export const JobClaimSchema = defineSchema("semmal_job_claim_v1", {
  job_id: str().indexed(),
  task_id: str().indexed(),
  robot_id: str().indexed(),
  agent_id: str().indexed(),
  body: bytes(),
});

/** Index of an episode bundle on 0G Storage. Owner: robot wallet. */
export const EpisodeSchema = defineSchema("semmal_episode_v1", {
  episode_id: str().indexed(),
  task_id: str().indexed(),
  robot_id: str().indexed(),
  outcome: str().indexed(),
  storage_root: str().indexed(),
  ended_at: u64().indexed(),
  body: bytes(),
});

/**
 * Episode index v2: v1 plus the robot's own job score (task-score-v1) as an indexed column, so scores
 * can be queried and ranked on Arkiv. The full score breakdown is in the body and the signed bundle.
 */
export const EpisodeSchemaV2 = defineSchema("semmal_episode_v2", {
  episode_id: str().indexed(),
  task_id: str().indexed(),
  robot_id: str().indexed(),
  outcome: str().indexed(),
  task_score: i32().indexed(),
  storage_root: str().indexed(),
  ended_at: u64().indexed(),
  body: bytes(),
});

/** Index of an incident bundle on 0G Storage. Owner: robot wallet. */
/** A robot's or agent's published score (score-v2; older checkpoints may say score-v1). Owner: the instance owner's wallet. Lives 120 days. */
export const ReputationSchema = defineSchema("semmal_reputation_v1", {
  subject_kind: str().indexed(),
  subject_id: str().indexed(),
  score: i32().indexed(),
  status: str().indexed(),
  body: bytes(),
});

export const IncidentSchema = defineSchema("semmal_incident_v1", {
  incident_id: str().indexed(),
  robot_id: str().indexed(),
  fault_code: str().indexed(),
  severity: str().indexed(),
  storage_root: str().indexed(),
  sequence: u64().indexed(),
  body: bytes(),
});
