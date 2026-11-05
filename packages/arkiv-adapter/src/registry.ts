import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq, desc } from "@arkiv-network/sdk/query";
import { getAddress, hexToString, http } from "viem";
import { AgentListing, RobotProfile, type AgentListing as TAgent, type RobotProfile as TRobot } from "@semmal/contracts";
import { AgentProfileSchema, RobotProfileSchema } from "./schemas";
import { RABDI_CHAIN_ID } from "./guarded-writer";
import { addr } from "@arkiv-network/sdk/schema";

export type RegistryEntry<T> = {
  provenance: "ARKIV";
  entityKey: string;
  owner: string;
  creator: string;
  expiresAtBlock: string;
  createdAt?: string;
  data: T;
};

export type ArkivConfig = {
  accessKey: string; // "" = public endpoint (heavily rate limited). Server-side only.
  profileTtlDays: number;
};

export function arkivConfigFromEnv(env = process.env): ArkivConfig {
  return { accessKey: env.ARKIV_ACCESS_KEY ?? "", profileTtlDays: Number(env.ARKIV_PROFILE_TTL_DAYS || 30) };
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
      ownership: "Arkiv $owner must equal the profile ownerWallet",
    };
  }

  /** Robots on Arkiv; optionally only those owned by one wallet. One live profile per robot. */
  async listRobots(filter: { robotId?: string; owner?: string } = {}): Promise<RegistryEntry<TRobot>[]> {
    let q = this.publicClient
      .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, $createdAt: true, robot_id: true, profile: true })
      .from(RobotProfileSchema);
    if (filter.robotId) q = q.where(eq("robot_id", filter.robotId));
    else if (filter.owner) q = q.where(eq("owner_wallet", addr(getAddress(filter.owner))));
    const page = await q.limit(100).fetch();
    const entries = this.toEntries(page.entities, "profile", RobotProfile, (d) => d.ownerWallet);
    // a robot wallet belongs to whoever registered it first; later claims by others are ignored,
    // and of the owner's own versions only the newest is shown
    const byWallet = new Map<string, RegistryEntry<TRobot>>();
    const firstOwner = new Map<string, string>();
    const sorted = [...entries].sort((x, y) => Number(BigInt(x.createdAt ?? "0") - BigInt(y.createdAt ?? "0")));
    for (const e of sorted) {
      const w = e.data.robotWallet.toLowerCase();
      if (!firstOwner.has(w)) firstOwner.set(w, e.owner.toLowerCase());
      if (firstOwner.get(w) !== e.owner.toLowerCase()) continue;
      const cur = byWallet.get(w);
      if (!cur || e.data.profileVersion > cur.data.profileVersion) byWallet.set(w, e);
    }
    return [...byWallet.values()];
  }

  /**
   * Every robot profile for a robot wallet, from ANY creator (no trust filter): used to keep robot
   * ids unique and to decide the next profile version before a wallet publishes.
   */
  async robotsByWallet(wallet: string) {
    const page = await this.publicClient
      .select({ $key: true, $owner: true, $creator: true, robot_id: true, profile_version: true })
      .from(RobotProfileSchema)
      .where(eq("robot_wallet", addr(getAddress(wallet))))
      .limit(100)
      .fetch();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.entities.map((r: any) => ({
      entityKey: String(r.$key),
      owner: String(r.$owner),
      creator: String(r.$creator),
      robotId: String(r.robot_id?.value ?? ""),
      profileVersion: Number(r.profile_version?.value ?? 0),
    }));
  }

  async listAgents(filter: { kind?: string; agentId?: string } = {}): Promise<RegistryEntry<TAgent>[]> {
    let q = this.publicClient
      .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, $createdAt: true, agent_id: true, listing: true })
      .from(AgentProfileSchema);
    if (filter.agentId) q = q.where(eq("agent_id", filter.agentId));
    else if (filter.kind) q = q.where(eq("kind", filter.kind));
    const page = await q.orderBy(desc("price")).limit(100).fetch();
    return this.toEntries(page.entities, "listing", AgentListing, (d) => d.ownerWallet);
  }

  /**
   * Entity bodies are untrusted: parse them, and keep an entity only when Arkiv's own $owner and
   * $creator equal the wallet the profile claims as its owner. Nobody can publish a profile "for"
   * someone else's wallet, and only that wallet can change or delete it.
   */
  private toEntries<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: readonly any[],
    col: string,
    parser: { safeParse(v: unknown): { success: boolean; data?: T } },
    ownerOf: (d: T) => string,
  ) {
    const out: RegistryEntry<T>[] = [];
    for (const row of rows) {
      const parsed = parser.safeParse(decodeJson(row[col]));
      if (!parsed.success || !parsed.data) continue;
      try {
        const claimed = getAddress(ownerOf(parsed.data));
        if (getAddress(String(row.$owner)) !== claimed || getAddress(String(row.$creator)) !== claimed) continue;
      } catch {
        continue;
      }
      out.push({
        provenance: "ARKIV",
        entityKey: String(row.$key),
        owner: String(row.$owner),
        creator: String(row.$creator),
        expiresAtBlock: String(row.$expiresAt),
        createdAt: row.$createdAt === undefined ? undefined : String(row.$createdAt),
        data: parsed.data,
      });
    }
    return out;
  }
}
