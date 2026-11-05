/**
 * The agent network as a graph: robots (hubs), specialist agents, one 0G private-compute enclave
 * at the core, and a ring of Arkiv records. Deterministic (seeded) so every visit looks the same.
 * Only nodes that come from the registry API carry a name; the rest are unnamed to show scale,
 * never presented as real listings.
 */
export type NodeKind = "robot" | "agent" | "enclave" | "ledger";
export type EdgeKind = "hire" | "private" | "record" | "peer";

export type GNode = {
  id: number;
  kind: NodeKind;
  p: [number, number, number];
  size: number;
  label?: string;
  sub?: string;
  phase: number;
  hub?: number;
};
export type GEdge = { a: number; b: number; kind: EdgeKind };
export type Graph = { nodes: GNode[]; edges: GEdge[]; mainHub: number; enclave: number; ledger: number[]; neighbors: number[][] };

export type NamedEntry = { label: string; sub: string; kind: string };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildGraph(opts: { robots: NamedEntry[]; agents: NamedEntry[]; dense: boolean }): Graph {
  const r = rng(20261106);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const add = (n: Omit<GNode, "id" | "phase">) => {
    nodes.push({ ...n, id: nodes.length, phase: r() * Math.PI * 2 });
    return nodes.length - 1;
  };

  const enclave = add({ kind: "enclave", p: [0, 0, 0], size: 1, label: "0G private compute", sub: "TeeML enclave · prompts stay inside" });

  const HUBS = opts.dense ? 6 : 4;
  const hubs: number[] = [];
  for (let h = 0; h < HUBS; h++) {
    const a = (h / HUBS) * Math.PI * 2 + r() * 0.4;
    const named = h === 0 ? opts.robots[0] : undefined;
    hubs.push(
      add({
        kind: "robot",
        p: [Math.cos(a) * 4.2, (r() - 0.5) * 2.4, Math.sin(a) * 4.2],
        size: h === 0 ? 1.35 : 1,
        label: named?.label,
        sub: named?.sub,
        hub: h,
      }),
    );
  }

  // the named agents hang off the main robot
  const namedAgents = opts.agents.map((a) =>
    add({ kind: "agent", p: [0, 0, 0], size: 0.62, label: a.label, sub: a.sub, hub: 0 }),
  );
  namedAgents.forEach((id, i) => {
    edges.push({ a: hubs[0]!, b: id, kind: "hire" });
    if (opts.agents[i]!.kind === "vision" || opts.agents[i]!.kind === "maintenance" || opts.agents[i]!.kind === "inspection")
      edges.push({ a: id, b: enclave, kind: "private" });
  });
  // inspection agents may delegate to a vision agent (bounded delegation)
  const insp = opts.agents.findIndex((a) => a.kind === "inspection");
  const vis = opts.agents.findIndex((a) => a.kind === "vision");
  if (insp >= 0 && vis >= 0) edges.push({ a: namedAgents[insp]!, b: namedAgents[vis]!, kind: "peer" });

  // unnamed agents around every hub
  const PER = opts.dense ? 13 : 8;
  for (let h = 0; h < HUBS; h++) {
    for (let k = 0; k < PER; k++) {
      const id = add({ kind: "agent", p: [0, 0, 0], size: 0.38 + r() * 0.3, hub: h });
      edges.push({ a: hubs[h]!, b: id, kind: "hire" });
      if (r() < 0.45) edges.push({ a: id, b: enclave, kind: "private" });
      if (r() < 0.22) edges.push({ a: hubs[(h + 1 + Math.floor(r() * (HUBS - 1))) % HUBS]!, b: id, kind: "hire" });
    }
  }
  // agent-to-agent delegation inside clusters
  const agents = nodes.filter((n) => n.kind === "agent");
  for (let i = 0; i < agents.length; i++) {
    if (r() < 0.3) {
      const j = agents.find((m) => m.hub === agents[i]!.hub && m.id !== agents[i]!.id && r() < 0.3);
      if (j) edges.push({ a: agents[i]!.id, b: j.id, kind: "peer" });
    }
  }

  // Arkiv ring: records every robot writes
  const LEDGER = opts.dense ? 36 : 24;
  const ledger: number[] = [];
  for (let i = 0; i < LEDGER; i++) {
    const a = (i / LEDGER) * Math.PI * 2;
    ledger.push(add({ kind: "ledger", p: [Math.cos(a) * 7.4, -3.6, Math.sin(a) * 7.4], size: 1, label: i === 0 ? "Arkiv" : undefined, sub: i === 0 ? "Episode and incident records" : undefined }));
  }
  hubs.forEach((h, k) => {
    for (let j = 0; j < 3; j++) edges.push({ a: h, b: ledger[(k * Math.floor(LEDGER / HUBS) + j * 2) % LEDGER]!, kind: "record" });
  });

  layout(nodes, edges, r);

  const neighbors = nodes.map(() => [] as number[]);
  edges.forEach((e) => {
    neighbors[e.a]!.push(e.b);
    neighbors[e.b]!.push(e.a);
  });
  return { nodes, edges, mainHub: hubs[0]!, enclave, ledger, neighbors };
}

/** Small 3D force layout for agents only; robots, enclave and ledger keep their anchors. */
function layout(nodes: GNode[], edges: GEdge[], r: () => number) {
  const free = nodes.filter((n) => n.kind === "agent");
  for (const n of free) {
    const hub = nodes.find((m) => m.kind === "robot" && m.hub === n.hub)!;
    n.p = [hub.p[0] + (r() - 0.5) * 3, hub.p[1] + (r() - 0.5) * 3, hub.p[2] + (r() - 0.5) * 3];
  }
  const v = new Map(free.map((n) => [n.id, [0, 0, 0]]));
  const linked = edges.filter((e) => e.kind !== "record");
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    for (const a of free) {
      const f = v.get(a.id)!;
      for (const b of nodes) {
        if (a === b || b.kind === "ledger") continue;
        const dx = a.p[0] - b.p[0], dy = a.p[1] - b.p[1], dz = a.p[2] - b.p[2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const k = (b.kind === "enclave" ? 2.6 : 0.16) / d2;
        f[0] += dx * k; f[1] += dy * k; f[2] += dz * k;
      }
    }
    for (const e of linked) {
      const a = nodes[e.a]!, b = nodes[e.b]!;
      const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      const rest = e.kind === "private" ? 3.2 : e.kind === "peer" ? 1.1 : 1.6;
      const k = ((d - rest) / d) * 0.04;
      if (v.has(a.id)) { const f = v.get(a.id)!; f[0] += dx * k; f[1] += dy * k; f[2] += dz * k; }
      if (v.has(b.id)) { const f = v.get(b.id)!; f[0] -= dx * k; f[1] -= dy * k; f[2] -= dz * k; }
    }
    for (const n of free) {
      const f = v.get(n.id)!;
      n.p[0] += f[0] * cool; n.p[1] += f[1] * cool * 0.7; n.p[2] += f[2] * cool;
      f[0] = f[1] = f[2] = 0;
      // keep the cloud above the Arkiv ring
      if (n.p[1] < -2.4) n.p[1] = -2.4;
    }
  }
}
