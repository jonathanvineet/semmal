"use client";
/**
 * The scroll-driven mission: one warehouse, one robot, four chapters.
 *   0.00-0.25  task assigned by the marketplace
 *   0.25-0.50  the robot discovers and hires specialists (from the Arkiv registry)
 *   0.50-0.78  it reaches the panel; the vision specialist calls 0G in private mode
 *   0.78-1.00  simulated left-motor fault: local safe stop, evidence bundle indexed on Arkiv
 * `progress` is written by ScrollTrigger (native scroll, nothing captures the wheel).
 */
import { ContactShadows, Line, Float } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Robot, type RobotState } from "./Robot";
import { Warehouse } from "./Warehouse";

const damp = THREE.MathUtils.damp;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

const KEYS: { p: number; pos: [number, number, number]; look: [number, number, number] }[] = [
  { p: 0.0, pos: [6.2, 4.4, 9.5], look: [0, 0.8, 2.5] },
  { p: 0.28, pos: [-4.6, 3.6, 7.4], look: [0, 1.6, 2.6] },
  { p: 0.52, pos: [-2.6, 1.9, 0.6], look: [0, 0.8, -3.2] },
  { p: 0.7, pos: [2.4, 1.5, -1.6], look: [0, 0.8, -5.4] },
  { p: 0.86, pos: [3.2, 2.0, -1.4], look: [0, 0.5, -4.2] },
  { p: 1.0, pos: [4.6, 4.6, 0.8], look: [0, 2.4, -4.4] },
];

function cameraAt(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1]!.p) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = THREE.MathUtils.smoothstep(p, a.p, b.p);
  pos.set(...a.pos).lerp(new THREE.Vector3(...b.pos), t);
  look.set(...a.look).lerp(new THREE.Vector3(...b.look), t);
}

const AGENTS = [
  { label: "vision-a", hired: true, offset: new THREE.Vector3(-1.6, 2.5, -0.4), color: "#ff4a1f" },
  { label: "vision-b", hired: false, offset: new THREE.Vector3(-0.5, 3.0, 1.2), color: "#9c9ea3" },
  { label: "inspect", hired: true, offset: new THREE.Vector3(1.4, 2.7, -0.2), color: "#ff4a1f" },
  { label: "maint", hired: false, offset: new THREE.Vector3(0.6, 2.2, 1.6), color: "#9c9ea3" },
];

function AgentNode({ color, hired, groupRef }: { color: string; hired: boolean; groupRef: (g: THREE.Group | null) => void }) {
  return (
    <group ref={groupRef}>
      <Float speed={2} rotationIntensity={0.6} floatIntensity={0.4}>
        <mesh>
          <octahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hired ? 1.6 : 0.25} metalness={0.3} roughness={0.3} toneMapped={false} transparent />
        </mesh>
        <mesh scale={1.7}>
          <octahedronGeometry args={[0.2, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.35} />
        </mesh>
      </Float>
    </group>
  );
}

export function MissionScene({ progress }: { progress: React.MutableRefObject<number> }) {
  const robot = useRef<THREE.Group>(null);
  const state = useRef<RobotState>("normal");
  const speed = useRef(0);
  const glow = useRef(0);
  const alarm = useRef(0);
  const shown = useRef(0);
  const agentGroups = useRef<(THREE.Group | null)[]>([]);
  const lineMats = useRef<(THREE.Material & { dashOffset?: number; opacity: number })[]>([]);
  const cone = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const bundle = useRef<THREE.Mesh>(null);
  const chain = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const camPos = useMemo(() => new THREE.Vector3(), []);
  const camLook = useMemo(() => new THREE.Vector3(), []);
  const curLook = useRef(new THREE.Vector3(0, 0.8, 2.5));
  const { camera } = useThree();
  const linePts = useMemo(() => AGENTS.map(() => [new THREE.Vector3(), new THREE.Vector3()] as [THREE.Vector3, THREE.Vector3]), []);

  useFrame((_, dt) => {
    const target = progress.current;
    const prev = shown.current;
    shown.current = damp(shown.current, target, 4, dt);
    const p = shown.current;

    // robot drive: z 4.5 -> -4.3 between 0.30 and 0.64
    const drive = smooth(0.3, 0.64, p);
    const z = THREE.MathUtils.lerp(4.5, -4.3, drive);
    if (robot.current) {
      robot.current.position.z = z;
      robot.current.position.x = Math.sin(drive * Math.PI) * 0.35;
    }
    const moving = p > 0.3 && p < 0.64;
    speed.current = moving ? Math.sign(p - prev || 1) * 2.4 : damp(speed.current, 0, 6, dt);
    state.current = p >= 0.79 ? "estop" : p >= 0.56 ? "scanning" : "normal";

    // task beacon under the robot (chapter 1)
    if (beacon.current) {
      const a = 1 - smooth(0.2, 0.3, p);
      const t = (performance.now() / 1400) % 1;
      beacon.current.scale.setScalar(0.6 + t * 1.6);
      (beacon.current.material as THREE.MeshBasicMaterial).opacity = a * (1 - t) * 0.9;
      beacon.current.position.z = z;
    }

    // specialists (chapter 2): appear, hired ones get a live link
    const show = smooth(0.18, 0.3, p) * (1 - smooth(0.62, 0.72, p));
    const link = smooth(0.32, 0.44, p);
    AGENTS.forEach((a, i) => {
      const g = agentGroups.current[i];
      if (!g || !robot.current) return;
      g.position.copy(robot.current.position).add(a.offset);
      g.scale.setScalar(Math.max(0.001, show * (a.hired ? 1 : 0.85)));
      const [from, to] = linePts[i]!;
      from.copy(robot.current.position).setY(1.0);
      to.copy(g.position);
      const m = lineMats.current[i];
      if (m) {
        m.opacity = show * (a.hired ? link : 0.18);
        if (m.dashOffset !== undefined) m.dashOffset -= dt * (a.hired ? 1.6 : 0.3);
      }
    });

    // vision call (chapter 3)
    glow.current = smooth(0.58, 0.68, p);
    if (cone.current && robot.current) {
      const o = smooth(0.56, 0.62, p) * (1 - smooth(0.76, 0.8, p));
      (cone.current.material as THREE.MeshBasicMaterial).opacity = o * (0.16 + Math.sin(performance.now() / 110) * 0.04);
      cone.current.position.set(robot.current.position.x * 0.5, 0.95, (z + -6.0) / 2);
      cone.current.lookAt(0, 0.95, -6.0);
      cone.current.rotateX(Math.PI / 2);
      cone.current.scale.set(1, Math.max(0.001, Math.abs(z + 6.0) - 0.4), 1);
    }

    // fault (chapter 4): red ring at the left wheel, then the bundle rises into the chain
    alarm.current = smooth(0.79, 0.83, p);
    if (ring.current && robot.current) {
      const t = (performance.now() / 700) % 1;
      ring.current.position.set(robot.current.position.x - 0.47, 0.02, z + 0.08);
      ring.current.scale.setScalar(0.3 + t * 1.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = alarm.current * (1 - t);
    }
    const rise = smooth(0.86, 0.97, p);
    if (bundle.current && robot.current) {
      bundle.current.visible = p > 0.83;
      bundle.current.position.set(robot.current.position.x, THREE.MathUtils.lerp(0.8, 3.55, rise), z);
      bundle.current.rotation.y += dt * (1.2 - rise);
      bundle.current.scale.setScalar(THREE.MathUtils.lerp(0.22, 0.36, rise));
    }
    if (chain.current) {
      chain.current.position.z = z;
      chain.current.visible = p > 0.8;
      chain.current.children.forEach((c, i) => {
        const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        m.opacity = smooth(0.8 + i * 0.015, 0.86 + i * 0.015, p);
      });
    }

    cameraAt(p, camPos, camLook);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6));
    curLook.current.lerp(camLook, 1 - Math.exp(-dt * 6));
    camera.lookAt(curLook.current);
  });

  return (
    <>
      <color attach="background" args={["#18191b"]} />
      <fog attach="fog" args={["#18191b", 9, 26]} />
      <hemisphereLight args={["#d9dde3", "#18191b", 0.5]} />
      <directionalLight position={[5, 9, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
      <pointLight position={[0, 2.6, -5]} intensity={6} distance={7} color="#ff6a3d" />
      <Warehouse glowRef={glow} alarmRef={alarm} />
      <Robot ref={robot} stateRef={state} speedRef={speed} position={[0, 0, 4.5]} />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.6} scale={30} blur={2.4} far={3} />

      <mesh ref={beacon} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 4.5]}>
        <ringGeometry args={[0.7, 0.76, 64]} />
        <meshBasicMaterial color="#ff4a1f" transparent opacity={0} toneMapped={false} />
      </mesh>

      {AGENTS.map((a, i) => (
        <group key={a.label}>
          <AgentNode color={a.color} hired={a.hired} groupRef={(g) => (agentGroups.current[i] = g)} />
          <Line
            points={linePts[i]!}
            color={a.hired ? "#ff4a1f" : "#9c9ea3"}
            lineWidth={a.hired ? 2 : 1}
            dashed
            dashSize={0.12}
            gapSize={0.08}
            transparent
            opacity={0}
            ref={(l: unknown) => {
              const mat = (l as { material?: THREE.Material } | null)?.material;
              if (mat) lineMats.current[i] = mat as THREE.Material & { dashOffset?: number; opacity: number };
            }}
          />
        </group>
      ))}

      <mesh ref={cone}>
        <coneGeometry args={[0.9, 1, 48, 1, true]} />
        <meshBasicMaterial color="#2ee6a6" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>

      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.36, 48]} />
        <meshBasicMaterial color="#ff2238" transparent opacity={0} toneMapped={false} />
      </mesh>

      <mesh ref={bundle} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#eff0f1" emissive="#ff4a1f" emissiveIntensity={0.6} metalness={0.2} roughness={0.3} />
      </mesh>
      <group ref={chain} position={[0, 0, 0]} visible={false}>
        {[-1.35, -0.9, -0.45].map((x, i) => (
          <mesh key={i} position={[x, 3.55, 0]}>
            <boxGeometry args={[0.36, 0.36, 0.36]} />
            <meshStandardMaterial color="#3b3f45" emissive="#ff4a1f" emissiveIntensity={0.15} transparent opacity={0} />
          </mesh>
        ))}
      </group>
    </>
  );
}
