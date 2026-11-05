"use client";
/**
 * The agent network in 3D. Soft by construction: curved, tapered links drawn as anti-aliased fat
 * lines; smooth round nodes with halos; glowing pulse dots; a fresnel glass enclave for 0G private
 * compute; rounded Arkiv record blocks. Orange = a robot hiring an agent, ice = a private inference
 * call, white = a record written. `progress` (0..1, native scroll) moves the camera through four
 * chapters. Drag to turn the network, click a node to pin it.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildGraph, type Graph, type NamedEntry } from "./graph";

const BG = "#0d0d10";
const C = {
  robot: new THREE.Color("#ff7a4a").multiplyScalar(1.9),
  agent: new THREE.Color("#ecebe8").multiplyScalar(1.2),
  agentDim: new THREE.Color("#4c4f55"),
  ledger: new THREE.Color("#d8d6d2"),
  hire: new THREE.Color("#ff7a4a"),
  private: new THREE.Color("#8fd8ff"),
  record: new THREE.Color("#ecebe8"),
  peer: new THREE.Color("#a7a9ae"),
};
const SEG = 14; // segments per curved link

type Shot = { p: number; cam: [number, number, number]; look: [number, number, number]; shift: number };
const SHOTS: Shot[] = [
  { p: 0.0, cam: [0, 2.2, 17], look: [0, 0, 0], shift: 3.6 },
  { p: 0.22, cam: [-9.5, 4.5, 12], look: [0, -0.4, 0], shift: 0 },
  { p: 0.46, cam: [0, 0, 0], look: [0, 0, 0], shift: 0 },
  { p: 0.7, cam: [1.8, 0.7, 3.6], look: [0, 0, 0], shift: 0 },
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

/** A soft round sprite for pulses and halos. */
function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.18)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Quadratic bezier that bows each link outward from the network's centre. */
function curvePoint(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3, ctrl: THREE.Vector3) {
  ctrl.copy(a).add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const lenC = ctrl.length();
  if (lenC > 0.1) ctrl.multiplyScalar(1 + (len * 0.22) / lenC);
  else ctrl.addScaledVector(UP, len * 0.22);
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
    u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
    u * u * a.z + 2 * u * t * ctrl.z + t * t * b.z,
  );
}

const fresnelMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#8fd8ff") }, uPower: { value: 2.4 }, uGain: { value: 1.1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower; uniform float uGain;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        gl_FragColor = vec4(uColor * rim * uGain, rim);
      }`,
  });

function World({ graph, progress, reduced, dense, ambient }: { graph: Graph; progress: React.MutableRefObject<number>; reduced: boolean; dense: boolean; ambient: boolean }) {
  const { nodes, edges } = graph;
  const { camera, pointer, gl, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const nodeMesh = useRef<THREE.InstancedMesh>(null);
  const ledgerMesh = useRef<THREE.InstancedMesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [chap, setChap] = useState(0);
  const shown = useRef(0);
  const cam = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const curLook = useRef(new THREE.Vector3());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Vector3(), prev: new THREE.Vector3(), col: new THREE.Color() }), []);
  const live = useMemo(() => nodes.map((n) => new THREE.Vector3(...n.p)), [nodes]);
  const graphNodes = useMemo(() => nodes.filter((n) => n.kind === "robot" || n.kind === "agent"), [nodes]);
  const ledgerNodes = useMemo(() => nodes.filter((n) => n.kind === "ledger"), [nodes]);
  const dot = useMemo(() => softDot(), []);
  const shellMat = useMemo(() => fresnelMat(), []);
  const ledgerGeo = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 4, 0.32), []);

  // drag to turn, click to pin
  const drag = useRef({ down: false, moved: 0, x: 0, y: 0, yaw: 0, pitch: 0, auto: 0 });
  useEffect(() => {
    if (ambient) return;
    const el = gl.domElement;
    const down = (e: PointerEvent) => { Object.assign(drag.current, { down: true, moved: 0, x: e.clientX, y: e.clientY }); el.style.cursor = "grabbing"; };
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
  }, [gl, ambient]);

  const shots = useMemo(() => {
    const hub = new THREE.Vector3(...nodes[graph.mainHub]!.p);
    const out = hub.clone().normalize().multiplyScalar(4.4).add(new THREE.Vector3(0, 1.4, 0));
    const s = SHOTS.map((x) => ({ ...x }));
    s[2] = { p: 0.46, cam: [hub.x + out.x, hub.y + out.y, hub.z + out.z], look: [hub.x, hub.y, hub.z], shift: 0 };
    return s;
  }, [nodes, graph.mainHub]);

  // curved, tapered, anti-aliased links: one LineSegments2, SEG segments per edge
  const links = useMemo(() => {
    const geo = new LineSegmentsGeometry();
    const n = edges.length * SEG;
    geo.setPositions(new Float32Array(n * 6));
    geo.setColors(new Float32Array(n * 6));
    const mat = new LineMaterial({ vertexColors: true, linewidth: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const obj = new LineSegments2(geo, mat);
    obj.frustumCulled = false;
    return { geo, mat, obj };
  }, [edges.length]);
  useEffect(() => { links.mat.resolution.set(size.width, size.height); }, [links, size]);
  useEffect(() => () => { links.geo.dispose(); links.mat.dispose(); }, [links]);

  // pulses and halos as soft points
  const PULSES = ambient ? (dense ? 60 : 30) : dense ? 110 : 56;
  const pulses = useMemo(() => Array.from({ length: PULSES }, (_, i) => ({ e: (i * 7) % edges.length, t: Math.random(), speed: 0.35 + Math.random() * 0.55 })), [PULSES, edges.length]);
  const pulseGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PULSES * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(PULSES * 3), 3));
    return g;
  }, [PULSES]);
  const haloNodes = useMemo(() => graphNodes.filter((n) => n.kind === "robot" || n.label), [graphNodes]);
  const haloGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(haloNodes.length * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(haloNodes.length * 3), 3));
    return g;
  }, [haloNodes]);
  const coreGlowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    return g;
  }, []);

  useFrame((state, dt) => {
    const time = state.clock.elapsedTime;
    shown.current = reduced ? progress.current : THREE.MathUtils.damp(shown.current, progress.current, 3.2, dt);
    const p = shown.current;
    const chapter = p < 0.12 ? 0 : p < 0.34 ? 1 : p < 0.58 ? 2 : p < 0.82 ? 3 : 4;
    const drift = reduced ? 0 : 1;

    nodes.forEach((n, i) => {
      const v = live[i]!;
      if (n.kind === "ledger") {
        const a = Math.atan2(n.p[2], n.p[0]) + time * 0.035 * drift;
        v.set(Math.cos(a) * 7.4, -3.6, Math.sin(a) * 7.4);
      } else if (n.kind === "enclave") v.set(0, 0, 0);
      else v.set(n.p[0] + Math.sin(time * 0.5 + n.phase) * 0.1 * drift, n.p[1] + Math.cos(time * 0.42 + n.phase) * 0.1 * drift, n.p[2] + Math.sin(time * 0.36 + n.phase * 1.3) * 0.1 * drift);
    });

    const focus = hover ?? pinned ?? (chapter === 2 ? graph.mainHub : chapter === 3 ? graph.enclave : null);
    const near = focus === null ? null : new Set([focus, ...graph.neighbors[focus]!]);

    // nodes: smooth spheres
    if (nodeMesh.current) {
      graphNodes.forEach((n, i) => {
        dummy.position.copy(live[n.id]!);
        dummy.scale.setScalar((n.kind === "robot" ? 0.19 : 0.08) * n.size * (hover === n.id || pinned === n.id ? 1.45 : 1));
        dummy.updateMatrix();
        nodeMesh.current!.setMatrixAt(i, dummy.matrix);
        tmp.col.copy(near && !near.has(n.id) ? C.agentDim : n.kind === "robot" ? C.robot : C.agent);
        nodeMesh.current!.setColorAt(i, tmp.col);
      });
      nodeMesh.current.instanceMatrix.needsUpdate = true;
      if (nodeMesh.current.instanceColor) nodeMesh.current.instanceColor.needsUpdate = true;
    }
    // halos behind robots and named agents
    {
      const pos = haloGeo.attributes.position as THREE.BufferAttribute;
      const col = haloGeo.attributes.color as THREE.BufferAttribute;
      haloNodes.forEach((n, i) => {
        const v = live[n.id]!;
        pos.setXYZ(i, v.x, v.y, v.z);
        const k = near && !near.has(n.id) ? 0.08 : n.kind === "robot" ? 0.55 : 0.28;
        const base = n.kind === "robot" ? C.hire : C.agent;
        col.setXYZ(i, base.r * k, base.g * k, base.b * k);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    // rounded Arkiv records
    if (ledgerMesh.current) {
      ledgerNodes.forEach((n, i) => {
        const v = live[n.id]!;
        dummy.position.copy(v);
        dummy.rotation.set(0, Math.atan2(v.x, v.z), 0);
        dummy.scale.set(0.36, 0.22, 0.36);
        dummy.updateMatrix();
        ledgerMesh.current!.setMatrixAt(i, dummy.matrix);
        const glow = chapter === 4 ? 0.9 + 0.8 * Math.max(0, Math.sin(time * 1.8 - i * 0.5)) : 0.45;
        ledgerMesh.current!.setColorAt(i, tmp.col.copy(C.ledger).multiplyScalar(glow));
      });
      ledgerMesh.current.instanceMatrix.needsUpdate = true;
      if (ledgerMesh.current.instanceColor) ledgerMesh.current.instanceColor.needsUpdate = true;
    }

    // curved links, tapered at both ends
    const start = links.geo.attributes.instanceStart as THREE.InterleavedBufferAttribute;
    const cstart = links.geo.attributes.instanceColorStart as THREE.InterleavedBufferAttribute;
    const P = start.data.array as Float32Array;
    const Ccol = cstart.data.array as Float32Array;
    edges.forEach((e, ei) => {
      const a = live[e.a]!, b = live[e.b]!;
      const on = !near || (near.has(e.a) && near.has(e.b) && (e.a === focus || e.b === focus));
      const k = on ? (e.kind === "record" ? 0.34 : e.kind === "peer" ? 0.26 : 0.5) : 0.045;
      const col = C[e.kind];
      tmp.prev.copy(a);
      for (let s = 0; s < SEG; s++) {
        const t1 = (s + 1) / SEG;
        const next = curvePoint(a, b, t1, tmp.v, tmp.c);
        const o = (ei * SEG + s) * 6;
        P[o] = tmp.prev.x; P[o + 1] = tmp.prev.y; P[o + 2] = tmp.prev.z;
        P[o + 3] = next.x; P[o + 4] = next.y; P[o + 5] = next.z;
        const f0 = Math.sin((s / SEG) * Math.PI) ** 0.7, f1 = Math.sin(t1 * Math.PI) ** 0.7;
        Ccol[o] = col.r * k * f0; Ccol[o + 1] = col.g * k * f0; Ccol[o + 2] = col.b * k * f0;
        Ccol[o + 3] = col.r * k * f1; Ccol[o + 4] = col.g * k * f1; Ccol[o + 5] = col.b * k * f1;
        tmp.prev.copy(next);
      }
    });
    start.data.needsUpdate = true;
    cstart.data.needsUpdate = true;

    // pulses ride the same curves
    {
      const want = chapter === 2 ? "hire" : chapter === 3 ? "private" : chapter === 4 ? "record" : null;
      const pos = pulseGeo.attributes.position as THREE.BufferAttribute;
      const col = pulseGeo.attributes.color as THREE.BufferAttribute;
      pulses.forEach((pl, i) => {
        if (!reduced) pl.t += dt * pl.speed;
        if (pl.t >= 1) {
          pl.t = 0;
          let e = Math.floor(Math.random() * edges.length);
          if (want && Math.random() < 0.8) for (let k = 0; k < 14 && edges[e]!.kind !== want; k++) e = Math.floor(Math.random() * edges.length);
          if (focus !== null && Math.random() < 0.6) {
            const own = graph.neighbors[focus]!;
            const other = own[Math.floor(Math.random() * own.length)];
            const idx = edges.findIndex((x) => (x.a === focus && x.b === other) || (x.b === focus && x.a === other));
            if (idx >= 0) e = idx;
          }
          pl.e = e;
        }
        const ed = edges[pl.e]!;
        const v = curvePoint(live[ed.a]!, live[ed.b]!, pl.t, tmp.v, tmp.c);
        pos.setXYZ(i, v.x, v.y, v.z);
        const fade = Math.sin(pl.t * Math.PI);
        const c = C[ed.kind];
        col.setXYZ(i, c.r * fade * 1.6, c.g * fade * 1.6, c.b * fade * 1.6);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    // enclave: soft breathing glass, slow rings
    if (shell.current && core.current && rings.current) {
      shell.current.scale.setScalar(1 + Math.sin(time * 1.1) * 0.025 * drift);
      shellMat.uniforms.uGain!.value = chapter === 3 ? 1.9 : 1.05;
      rings.current.rotation.y += dt * 0.12 * drift;
      rings.current.rotation.z += dt * 0.05 * drift;
      (core.current.material as THREE.MeshBasicMaterial).color.copy(C.private).multiplyScalar(chapter === 3 ? 2.6 : 1.3);
    }

    // camera through the chapters
    const shift = shotAt(p, shots, cam, look);
    if (group.current) {
      const g = group.current, d = drag.current;
      g.position.x = THREE.MathUtils.damp(g.position.x, shift, 4, dt);
      if (!reduced && (ambient || (p < 0.1 && !d.down))) d.auto += dt * (ambient ? 0.025 : 0.045);
      else if (p >= 0.1) d.auto = THREE.MathUtils.damp(d.auto, Math.round(d.auto / (Math.PI * 2)) * Math.PI * 2, 2.5, dt);
      if (!d.down && p >= 0.1) d.yaw = THREE.MathUtils.damp(d.yaw, 0, 1.6, dt);
      if (!d.down) d.pitch = THREE.MathUtils.damp(d.pitch, 0, 1.2, dt);
      g.rotation.y = d.auto + d.yaw;
      g.rotation.x = d.pitch;
    }
    cam.x += pointer.x * (ambient ? 0.25 : 0.5) * drift;
    cam.y += pointer.y * (ambient ? 0.15 : 0.3) * drift;
    const k = 1 - Math.exp(-dt * (reduced ? 30 : 3.2));
    camera.position.lerp(cam, k);
    curLook.current.lerp(look, k);
    camera.lookAt(curLook.current);
    if (chapter !== chap) setChap(chapter);
  });

  const labelled = ambient ? [] : graphNodes.filter((n) => n.label);
  const tipFor = hover ?? pinned;
  return (
    <group ref={group}>
      <primitive object={links.obj} />
      <instancedMesh
        ref={nodeMesh}
        args={[undefined, undefined, graphNodes.length]}
        onPointerMove={(e) => { if (ambient) return; e.stopPropagation(); if (e.instanceId !== undefined) setHover(graphNodes[e.instanceId]!.id); }}
        onPointerOut={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (ambient || drag.current.moved > 6 || e.instanceId === undefined) return;
          const id = graphNodes[e.instanceId]!.id;
          setPinned((cur) => (cur === id ? null : id));
        }}
        onPointerMissed={() => setPinned(null)}
      >
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <points geometry={haloGeo}>
        <pointsMaterial map={dot} size={1.4} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={pulseGeo}>
        <pointsMaterial map={dot} size={0.32} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <instancedMesh ref={ledgerMesh} args={[ledgerGeo, undefined, ledgerNodes.length]}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* 0G private enclave: fresnel glass, two thin rings, a soft core */}
      <mesh ref={shell} material={shellMat}>
        <sphereGeometry args={[1.25, 64, 48]} />
      </mesh>
      <group ref={rings}>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.55, 0.008, 12, 160]} />
          <meshBasicMaterial color="#8fd8ff" transparent opacity={0.5} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 1.7, 0.6, 0]}>
          <torusGeometry args={[1.75, 0.006, 12, 160]} />
          <meshBasicMaterial color="#8fd8ff" transparent opacity={0.28} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={core}>
        <sphereGeometry args={[0.3, 48, 32]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <points geometry={coreGlowGeo}>
        <pointsMaterial map={dot} size={3.2} sizeAttenuation color="#8fd8ff" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>

      {/* the ring the records settle on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.62, 0]}>
        <torusGeometry args={[7.4, 0.01, 8, 220]} />
        <meshBasicMaterial color="#ecebe8" transparent opacity={0.22} />
      </mesh>

      {labelled.filter((n) => n.id === tipFor || (chap === 2 && n.hub === 0)).map((n) => (
        <Html key={n.id} position={live[n.id]!.toArray()} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div className="node-tip"><b>{n.label}</b><span>{n.sub}</span></div>
        </Html>
      ))}
    </group>
  );
}

export default function AgentWorld({
  progress,
  robots,
  agents,
  ambient = false,
}: {
  progress: React.MutableRefObject<number>;
  robots: NamedEntry[];
  agents: NamedEntry[];
  /** Background mode for every other page: calm, dimmed, no interaction, one fixed viewpoint. */
  ambient?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [env, setEnv] = useState({ reduced: false, dense: true });
  useEffect(() => {
    setEnv({ reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches, dense: window.matchMedia("(min-width: 768px)").matches });
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "120px" });
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);
  const graph = useMemo(() => buildGraph({ robots, agents, dense: env.dense }), [robots, agents, env.dense]);
  return (
    <div ref={host} className="world-canvas">
      <Canvas dpr={ambient ? [1, 1.25] : [1, 1.75]} frameloop={visible ? "always" : "never"} camera={{ position: [0, 2.2, 17], fov: 42, near: 0.1, far: 80 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 14, 34]} />
        <World graph={graph} progress={progress} reduced={env.reduced} dense={env.dense} ambient={ambient} />
        <EffectComposer multisampling={ambient ? 0 : 4}>
          <Bloom mipmapBlur intensity={ambient ? 0.8 : 0.95} luminanceThreshold={0.5} luminanceSmoothing={0.35} radius={0.8} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
