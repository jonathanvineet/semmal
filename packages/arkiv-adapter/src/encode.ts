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

export function robotCreateArgs(input: TRobot, ttlDays = 30) {
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
      price: dec(p.price.amount),
      profile_version: i32(p.profileVersion),
      display_name: p.displayName,
      profile: new TextEncoder().encode(canonicalJson(p)),
    },
    options: { expiration: ExpirationTime.fromDays(ttlDays) },
  };
}

export function agentCreateArgs(input: TAgent, ttlDays = 30) {
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
