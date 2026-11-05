"use client";
/**
 * The agent network in 3D, Obsidian-graph style. Robots are orange hubs, specialist agents white
 * nodes, the 0G private enclave a glass core, Arkiv a ring of records. Electric pulses run along
 * the links: orange = a robot hiring an agent, ice = a private inference call, white = a record
 * written. `progress` (0..1, native scroll) moves the camera through four chapters.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildGraph, type Graph, type NamedEntry } from "./graph";

const C = {
  robot: new THREE.Color("#ff5a2a").multiplyScalar(2.2),
  agent: new THREE.Color("#e9ecef").multiplyScalar(1.35),
  agentDim: new THREE.Color("#5d6168"),
  ledger: new THREE.Color("#c9cdd3"),
  hire: new THREE.Color("#ff5a2a"),
  private: new THREE.Color("#7fd3ff"),
  record: new THREE.Color("#e9ecef"),
  peer: new THREE.Color("#9ca1a8"),
};

type Shot = { p: number; cam: [number, number, number]; look: [number, number, number]; shift: number };
const SHOTS: Shot[] = [
  { p: 0.0, cam: [0, 2.2, 17], look: [0, 0, 0], shift: 3.6 },
  { p: 0.22, cam: [-9.5, 4.5, 12], look: [0, -0.4, 0], shift: 0 },
  { p: 0.46, cam: [0, 0, 0], look: [0, 0, 0], shift: 0 }, // filled at runtime: the main robot
  { p: 0.7, cam: [1.6, 0.6, 3.2], look: [0, 0, 0], shift: 0 },
  { p: 0.94, cam: [9.5, -1.2, 9.5], look: [0, -3.6, 0], shift: 0 },
];

function shotAt(p: number, shots: Shot[], cam: THREE.Vector3, look: THREE.Vector3) {
  let i = 0;
  while (i < shots.length - 2 && p > shots[i + 1]!.p) i++;
  const a = shots[i]!, b = shots[i + 1]!;
  const t = THREE.MathUtils.smootherstep(p, a.p, b.p);
  cam.set(...a.cam).lerp(new THREE.Vector3(...b.cam), t);
  look.set(...a.look).lerp(new THREE.Vector3(...b.look), t);
  return THREE.MathUtils.lerp(a.shift, b.shift, t);
}

function World({ graph, progress, reduced, dense }: { graph: Graph; progress: React.MutableRefObject<number>; reduced: boolean; dense: boolean }) {
  const { nodes, edges } = graph;
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const ledgerMesh = useRef<THREE.InstancedMesh>(null);
  const pulseMesh = useRef<THREE.InstancedMesh>(null);
  const lineGeo = useMemo(() => new THREE.BufferGeometry(), []);
  const shell = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [chap, setChap] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);
  const drag = useRef({ down: false, moved: 0, x: 0, y: 0, yaw: 0, pitch: 0, auto: 0 });
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { drag.current.down = true; drag.current.moved = 0; drag.current.x = e.clientX; drag.current.y = e.clientY; el.style.cursor = "grabbing"; };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.down) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      d.yaw += dx * 0.006;
      d.pitch = THREE.MathUtils.clamp(d.pitch + dy * 0.004, -0.5, 0.5);
    };
    const up = () => { drag.current.down = false; el.style.cursor = "grab"; };
    el.style.cursor = "grab";
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { el.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [gl]);
  const { camera, pointer } = useThree();
  const shown = useRef(0);
  const cam = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const curLook = useRef(new THREE.Vector3());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const live = useMemo(() => nodes.map((n) => new THREE.Vector3(...n.p)), [nodes]);

  const graphNodes = useMemo(() => nodes.filter((n) => n.kind === "robot" || n.kind === "agent"), [nodes]);
  const ledgerNodes = useMemo(() => nodes.filter((n) => n.kind === "ledger"), [nodes]);

  const shots = useMemo(() => {
    const hub = new THREE.Vector3(...nodes[graph.mainHub]!.p);
    const out = hub.clone().normalize().multiplyScalar(4.4).add(new THREE.Vector3(0, 1.4, 0));
    const s = SHOTS.map((x) => ({ ...x }));
    s[2] = { p: 0.46, cam: [hub.x + out.x, hub.y + out.y, hub.z + out.z], look: [hub.x, hub.y, hub.z], shift: 0 };
    return s;
  }, [nodes, graph.mainHub]);

  // edges: positions + colors, rewritten each frame (drift and highlight)
  const linePos = useMemo(() => new Float32Array(edges.length * 6), [edges]);
  const lineCol = useMemo(() => new Float32Array(edges.length * 6), [edges]);
  useEffect(() => {
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  }, [lineGeo, linePos, lineCol]);

  // pulses: each runs along one edge
  const PULSES = dense ? 90 : 48;
  const pulses = useMemo(
    () => Array.from({ length: PULSES }, (_, i) => ({ e: (i * 7) % edges.length, t: Math.random(), speed: 0.45 + Math.random() * 0.7 })),
    [PULSES, edges.length],
  );
  const tmpCol = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    const time = state.clock.elapsedTime;
    shown.current = reduced ? progress.current : THREE.MathUtils.damp(shown.current, progress.current, 3.2, dt);
    const p = shown.current;
    const chapter = p < 0.12 ? 0 : p < 0.34 ? 1 : p < 0.58 ? 2 : p < 0.82 ? 3 : 4;

    // drift: every node breathes a little (Obsidian-like), the ledger ring turns
    const drift = reduced ? 0 : 1;
    nodes.forEach((n, i) => {
      const v = live[i]!;
      if (n.kind === "ledger") {
        const a = Math.atan2(n.p[2], n.p[0]) + time * 0.04 * drift;
        v.set(Math.cos(a) * 7.4, -3.6, Math.sin(a) * 7.4);
      } else if (n.kind === "enclave") {
        v.set(0, 0, 0);
      } else {
        v.set(n.p[0] + Math.sin(time * 0.6 + n.phase) * 0.08 * drift, n.p[1] + Math.cos(time * 0.5 + n.phase) * 0.08 * drift, n.p[2] + Math.sin(time * 0.4 + n.phase * 1.3) * 0.08 * drift);
      }
    });

    // focus set: hovered node, or the chapter's subject
    const focus = hover ?? pinned ?? (chapter === 2 ? graph.mainHub : chapter === 3 ? graph.enclave : null);
    const near = focus === null ? null : new Set([focus, ...graph.neighbors[focus]!]);

    // nodes
    if (nodeMesh.current) {
      graphNodes.forEach((n, i) => {
        const v = live[n.id]!;
        const s = (n.kind === "robot" ? 0.2 : 0.085) * n.size * (hover === n.id ? 1.5 : 1);
        dummy.position.copy(v);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        nodeMesh.current!.setMatrixAt(i, dummy.matrix);
        const base = n.kind === "robot" ? C.robot : C.agent;
        tmpCol.copy(near && !near.has(n.id) ? C.agentDim : base);
        if (n.label && n.kind === "agent" && !near) tmpCol.multiplyScalar(1.25);
        nodeMesh.current!.setColorAt(i, tmpCol);
      });
      nodeMesh.current.instanceMatrix.needsUpdate = true;
      if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    }
    if (ledgerMesh.current) {
      const lit = chapter === 4;
      ledgerNodes.forEach((n, i) => {
        const v = live[n.id]!;
        dummy.position.copy(v);
        dummy.rotation.set(0, Math.atan2(v.x, v.z), 0);
        dummy.scale.set(0.34, 0.2, 0.34);
        dummy.updateMatrix();
        ledgerMesh.current!.setMatrixAt(i, dummy.matrix);
        const glow = lit ? 1 + 0.9 * Math.max(0, Math.sin(time * 2 - i * 0.5)) : 0.55;
        ledgerMesh.current!.setColorAt(i, tmpCol.copy(C.ledger).multiplyScalar(glow));
      });
      ledgerMesh.current.instanceMatrix.needsUpdate = true;
      if (ledgerMesh.current.instanceColor) ledgerMesh.current.instanceColor.needsUpdate = true;
    }

    // edges
    edges.forEach((e, i) => {
      const a = live[e.a]!, b = live[e.b]!;
      linePos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const on = !near || (near.has(e.a) && near.has(e.b) && (e.a === focus || e.b === focus));
      const k = on ? (e.kind === "record" ? 0.28 : e.kind === "peer" ? 0.22 : 0.42) : 0.05;
      const col = C[e.kind];
      lineCol.set([col.r * k, col.g * k, col.b * k, col.r * k, col.g * k, col.b * k], i * 6);
    });
    (lineGeo.attributes.position as THREE.BufferAttribute | undefined) && (lineGeo.attributes.position!.needsUpdate = true);
    (lineGeo.attributes.color as THREE.BufferAttribute | undefined) && (lineGeo.attributes.color!.needsUpdate = true);
    lineGeo.computeBoundingSphere();

    // pulses (galvanic): biased to the chapter's kind of link
    if (pulseMesh.current) {
      const want = chapter === 2 ? "hire" : chapter === 3 ? "private" : chapter === 4 ? "record" : null;
      pulses.forEach((pl, i) => {
        if (!reduced) pl.t += dt * pl.speed;
        if (pl.t >= 1) {
          pl.t = 0;
          let e = Math.floor(Math.random() * edges.length);
          if (want && Math.random() < 0.8) {
            for (let tries = 0; tries < 12 && edges[e]!.kind !== want; tries++) e = Math.floor(Math.random() * edges.length);
          }
          if (focus !== null && Math.random() < 0.6) {
            const own = edges.findIndex((x, j) => j >= Math.floor(Math.random() * edges.length) && (x.a === focus || x.b === focus));
            if (own >= 0) e = own;
          }
          pl.e = e;
        }
        const ed = edges[pl.e]!;
        const a = live[ed.a]!, b = live[ed.b]!;
        dummy.position.lerpVectors(a, b, pl.t);
        const s = 0.05 * Math.sin(pl.t * Math.PI) + 0.012;
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        pulseMesh.current!.setMatrixAt(i, dummy.matrix);
        pulseMesh.current!.setColorAt(i, tmpCol.copy(C[ed.kind]).multiplyScalar(4));
      });
      pulseMesh.current.instanceMatrix.needsUpdate = true;
      if (pulseMesh.current.instanceColor) pulseMesh.current.instanceColor.needsUpdate = true;
    }

    // enclave: breathes; brighter in chapter 3
    if (shell.current && core.current) {
      const s = 1.05 + Math.sin(time * 1.2) * 0.03 * drift;
      shell.current.scale.setScalar(s);
      shell.current.rotation.y += dt * 0.08 * drift;
      shell.current.rotation.x += dt * 0.03 * drift;
      const m = core.current.material as THREE.MeshBasicMaterial;
      m.color.copy(C.private).multiplyScalar(chapter === 3 ? 3.2 : 1.6);
    }

    // camera through the chapters, plus a little pointer parallax
    const shift = shotAt(p, shots, cam, look);
    if (group.current) {
      const g = group.current;
      const d = drag.current;
      g.position.x = THREE.MathUtils.damp(g.position.x, shift, 4, dt);
      if (!reduced && p < 0.1 && !d.down) d.auto += dt * 0.05;
      else if (p >= 0.1) d.auto = THREE.MathUtils.damp(d.auto, Math.round(d.auto / (Math.PI * 2)) * Math.PI * 2, 2.5, dt);
      if (!d.down && p >= 0.1) { d.yaw = THREE.MathUtils.damp(d.yaw, 0, 1.6, dt); }
      if (!d.down) d.pitch = THREE.MathUtils.damp(d.pitch, 0, 1.2, dt);
      g.rotation.y = d.auto + d.yaw;
      g.rotation.x = d.pitch;
    }
    cam.x += pointer.x * 0.6 * drift;
    cam.y += pointer.y * 0.35 * drift;
    const k = 1 - Math.exp(-dt * (reduced ? 30 : 3.5));
    camera.position.lerp(cam, k);
    curLook.current.lerp(look, k);
    camera.lookAt(curLook.current);
    if (chapter !== chap) setChap(chapter);
  });

  const labelled = graphNodes.filter((n) => n.label);
  return (
    <group ref={group}>
      <instancedMesh
        ref={nodeMesh}
        args={[undefined, undefined, graphNodes.length]}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) setHover(graphNodes[e.instanceId]!.id);
        }}
        onPointerOut={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (drag.current.moved > 6 || e.instanceId === undefined) return;
          const id = graphNodes[e.instanceId]!.id;
          setPinned((p) => (p === id ? null : id));
        }}
        onPointerMissed={() => setPinned(null)}
      >
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={ledgerMesh} args={[undefined, undefined, ledgerNodes.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pulseMesh} args={[undefined, undefined, PULSES]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
      </instancedMesh>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial vertexColors transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>

      {/* 0G private enclave: glass shell, wire lattice, bright core */}
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.25, 1]} />
        <meshBasicMaterial color="#7fd3ff" wireframe transparent opacity={0.22} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.18, 48, 48]} />
        <meshPhysicalMaterial color="#0d1418" roughness={0.15} metalness={0} transmission={0.6} thickness={1} transparent opacity={0.35} />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>

      {/* the ring the records settle on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.62, 0]}>
        <ringGeometry args={[7.05, 7.12, 160]} />
        <meshBasicMaterial color="#e9ecef" transparent opacity={0.18} />
      </mesh>

      {labelled.filter((n) => n.id === hover || n.id === pinned || (chap === 2 && n.hub === 0)).map((n) => (
        <Html key={n.id} position={live[n.id]!.toArray()} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div className="node-tip">
            <b>{n.label}</b>
            <span>{n.sub}</span>
          </div>
        </Html>
      ))}
      {(hover ?? pinned) !== null && !nodes[(hover ?? pinned)!]!.label && (
        <Html position={live[(hover ?? pinned)!]!.toArray()} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div className="node-tip node-tip--anon">
            <span>{nodes[(hover ?? pinned)!]!.kind === "robot" ? "Robot" : "Specialist agent"} · {graph.neighbors[(hover ?? pinned)!]!.length} links · illustrative</span>
          </div>
        </Html>
      )}
    </group>
  );
}

export default function AgentWorld({
  progress,
  robots,
  agents,
}: {
  progress: React.MutableRefObject<number>;
  robots: NamedEntry[];
  agents: NamedEntry[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [env, setEnv] = useState({ reduced: false, dense: true });
  useEffect(() => {
    setEnv({
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      dense: window.matchMedia("(min-width: 768px)").matches,
    });
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "120px" });
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);
  const graph = useMemo(() => buildGraph({ robots, agents, dense: env.dense }), [robots, agents, env.dense]);

  return (
    <div ref={host} className="world-canvas">
      <Canvas
        dpr={[1, 1.5]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [0, 2.2, 17], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0b0c0e"]} />
        <fog attach="fog" args={["#0b0c0e", 14, 34]} />
        <World graph={graph} progress={progress} reduced={env.reduced} dense={env.dense} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.2} radius={0.72} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
