/**
 * Arkiv entity schemas (SDK @arkiv-network/sdk 1.0.1, verified against installed source).
 * Only columns we filter or sort on are indexed. Full profiles go in a bytes() column as
 * canonical JSON (public data only, never secrets, live location or customer data).
 * str() columns hold at most 128 UTF-8 bytes; bytes() at most 128 KiB per create.
 */
import { bytes, dec, defineSchema, i32, str } from "@arkiv-network/sdk/schema";

export const RobotProfileSchema = defineSchema("semmal_robot_profile_v1", {
  robot_id: str().indexed(),
  robot_type: str().indexed(),
  service_area: str().indexed(),
  primary_capability: str().indexed(),
  price: dec().indexed(),
  profile_version: i32(),
  display_name: str(),
  profile: bytes(),
});

export const AgentProfileSchema = defineSchema("semmal_agent_profile_v1", {
  agent_id: str().indexed(),
  kind: str().indexed(),
  primary_capability: str().indexed(),
  trust_mode: str().indexed(),
  price: dec().indexed(),
  display_name: str(),
  listing: bytes(),
});
