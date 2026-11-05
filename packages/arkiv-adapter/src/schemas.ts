/**
 * Arkiv entity schemas (SDK @arkiv-network/sdk 1.0.1, verified against installed source).
 * Only columns we filter or sort on are indexed. Full profiles go in a bytes() column as
 * canonical JSON (public data only, never secrets, live location or customer data).
 * str() columns hold at most 128 UTF-8 bytes; bytes() at most 128 KiB per create.
 */
import { addr, bool, bytes, dec, defineSchema, i32, str } from "@arkiv-network/sdk/schema";

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
