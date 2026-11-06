/** Group the agent entities a wallet published on Arkiv (pure; used by the dashboard's delete). */
import type { AgentListing, Entry } from "./api";

export type Group = { agentId: string; latest: AgentListing; keys: string[] };

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Group this wallet's agent entities by agent id; every version is listed for deletion. */
export function groupMine(items: Entry<AgentListing>[], owner: string): Group[] {
  const by = new Map<string, { latest: Entry<AgentListing>; keys: string[] }>();
  for (const e of items) {
    if (!e.entityKey || !same(e.creator, owner) || !same(e.data.ownerWallet, owner)) continue;
    const g = by.get(e.data.agentId);
    if (!g) by.set(e.data.agentId, { latest: e, keys: [e.entityKey] });
    else {
      g.keys.push(e.entityKey);
      if (Number(e.createdAt ?? 0) > Number(g.latest.createdAt ?? 0)) g.latest = e;
    }
  }
  return [...by.entries()].map(([agentId, g]) => ({ agentId, latest: g.latest.data, keys: g.keys })).sort((a, b) => a.latest.displayName.localeCompare(b.latest.displayName));
}
