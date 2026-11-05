import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq, desc } from "@arkiv-network/sdk/query";
import { getAddress, hexToString, http } from "viem";
import { AgentListing, RobotProfile, type AgentListing as TAgent, type RobotProfile as TRobot } from "@semmal/contracts";
import { AgentProfileSchema, RobotProfileSchema } from "./schemas";
import { RABDI_CHAIN_ID } from "./guarded-writer";

export type RegistryEntry<T> = {
  provenance: "ARKIV";
  entityKey: string;
  owner: string;
  creator: string;
  expiresAtBlock: string;
  data: T;
};

export type ArkivConfig = {
  accessKey: string; // "" = public endpoint (heavily rate limited). Server-side only.
  /** Only entities created by these PUBLIC addresses are shown (live: read from the admin store). */
  trustedPublishers: () => string[];
  profileTtlDays: number;
};

export function arkivConfigFromEnv(env = process.env, trustedPublishers: () => string[] = () => []): ArkivConfig {
  return {
    accessKey: env.ARKIV_ACCESS_KEY ?? "",
    trustedPublishers,
    profileTtlDays: Number(env.ARKIV_PROFILE_TTL_DAYS || 30),
  };
}

function decodeJson(value: unknown): unknown {
  const hex = (value as { value?: string } | undefined)?.value;
  if (typeof hex !== "string" || !hex.startsWith("0x")) return undefined;
  try {
    return JSON.parse(hexToString(hex as `0x${string}`));
  } catch {
    return undefined;
  }
}

export class ArkivRegistry {
  readonly publicClient;

  constructor(readonly config: ArkivConfig) {
    const chain = rabdi({ accessKey: config.accessKey });
    this.publicClient = createPublicClient({ chain, transport: http(undefined, { timeout: 10_000, retryCount: 0 }) });
  }

  async status() {
    let chainId: number | null = null;
    let reachable = false;
    try {
      chainId = await this.publicClient.getChainId();
      reachable = chainId === RABDI_CHAIN_ID;
    } catch {
      reachable = false;
    }
    return {
      network: "Rabdi (Arkiv DB-Chain testnet)",
      expectedChainId: RABDI_CHAIN_ID,
      chainId,
      reachable,
      accessKeyConfigured: this.config.accessKey !== "",
      signing: "wallet only (no server key)",
      trustedPublisherCount: this.config.trustedPublishers().length,
    };
  }

  private trusted(creator: string | undefined) {
    if (!creator) return false;
    try {
      return this.config.trustedPublishers().includes(getAddress(creator));
    } catch {
      return false;
    }
  }

  async listRobots(filter: { robotId?: string } = {}): Promise<RegistryEntry<TRobot>[]> {
    let q = this.publicClient
      .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, robot_id: true, profile: true })
      .from(RobotProfileSchema);
    if (filter.robotId) q = q.where(eq("robot_id", filter.robotId));
    const page = await q.limit(100).fetch();
    return this.toEntries(page.entities, "profile", RobotProfile);
  }

  async listAgents(filter: { kind?: string; agentId?: string } = {}): Promise<RegistryEntry<TAgent>[]> {
    let q = this.publicClient
      .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, agent_id: true, listing: true })
      .from(AgentProfileSchema);
    if (filter.agentId) q = q.where(eq("agent_id", filter.agentId));
    else if (filter.kind) q = q.where(eq("kind", filter.kind));
    const page = await q.orderBy(desc("price")).limit(100).fetch();
    return this.toEntries(page.entities, "listing", AgentListing);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toEntries<T>(rows: readonly any[], col: string, parser: { safeParse(v: unknown): { success: boolean; data?: T } }) {
    const out: RegistryEntry<T>[] = [];
    for (const row of rows) {
      if (!this.trusted(row.$creator)) continue; // untrusted publisher: ignore
      const parsed = parser.safeParse(decodeJson(row[col])); // entity content is untrusted input
      if (!parsed.success || !parsed.data) continue;
      out.push({
        provenance: "ARKIV",
        entityKey: String(row.$key),
        owner: String(row.$owner),
        creator: String(row.$creator),
        expiresAtBlock: String(row.$expiresAt),
        data: parsed.data,
      });
    }
    return out;
  }
}
