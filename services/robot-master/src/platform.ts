/** Client for the SEMMAL platform API. Authenticates as this robot with its link token. */
import type { AgentListing, AgentResult, RobotProfile } from "@semmal/contracts";

type Entry<T> = { entityKey?: string; data: T };
export type CatalogModel = { id: string; promptNeuron: string; completionNeuron: string; verifiability: string | null };

export interface PlatformApi {
  robot(robotId: string): Promise<RobotProfile | null>;
  agents(): Promise<AgentListing[]>;
  catalog(): Promise<{ models: CatalogModel[] }>;
  runJob(agentId: string, job: Record<string, unknown>): Promise<AgentResult>;
  route(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<TravelRoute>;
  /** Hand a frame sent to 0G to the platform (memory only, for the customer to see). Returns its index. */
  postFrame?(taskId: string, stop: string, dataUrl: string): Promise<number>;
}

export type TravelRoute = { source: "osrm" | "straight-line"; distanceM: number; durationS: number; coords: [number, number][] };

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
    async route(from, to) {
      return get<TravelRoute>(`/api/route?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`);
    },
    async postFrame(taskId, stop, dataUrl) {
      const r = await fetch(`${base}/api/tasks/${taskId}/frames`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${linkToken}` },
        body: JSON.stringify({ stop, dataUrl }),
        signal: AbortSignal.timeout(15_000),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      return d.index as number;
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
