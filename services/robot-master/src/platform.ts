/** Client for the SEMMAL platform API. Authenticates as this robot with its link token. */
import type { AgentListing, AgentResult, RobotProfile } from "@semmal/contracts";

type Entry<T> = { entityKey?: string; data: T };
export type CatalogModel = { id: string; promptNeuron: string; completionNeuron: string; verifiability: string | null };

export interface PlatformApi {
  robot(robotId: string): Promise<RobotProfile | null>;
  agents(): Promise<AgentListing[]>;
  catalog(): Promise<{ models: CatalogModel[] }>;
  runJob(agentId: string, job: Record<string, unknown>): Promise<AgentResult>;
}

export function httpPlatform(base: string, linkToken: string): PlatformApi {
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  return {
    async robot(robotId) {
      const d = await get<{ items: Entry<RobotProfile>[] }>("/api/robots");
      return d.items.find((e) => e.data.robotId === robotId)?.data ?? null;
    },
    async agents() {
      return (await get<{ items: Entry<AgentListing>[] }>("/api/agents")).items.map((e) => e.data);
    },
    async catalog() {
      return get("/api/zerog/catalog");
    },
    async runJob(agentId, job) {
      const r = await fetch(`${base}/api/agents/${agentId}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${linkToken}` },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(60_000),
      });
      const d = await r.json();
      if (!d.status) throw new Error(d.error ?? `runner HTTP ${r.status}`);
      return d as AgentResult;
    },
  };
}
