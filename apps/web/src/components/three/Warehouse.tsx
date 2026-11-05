"use client";
/**
 * The simulated warehouse: one aisle between pallet racks, an inspection target (machine panel)
 * at the far end and a destination zone. Same layout idea as the Gazebo world in PLAN.md A.1.
 */
import { Grid, Instance, Instances, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useMemo, useRef } from "react";
import * as THREE from "three";

export const PANEL_POS = new THREE.Vector3(0, 0, -6.2);

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function Racks() {
  const cartons = useMemo(() => {
    const rnd = seeded(7);
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const tones = ["#6e5b44", "#7d6a50", "#5f4f3c", "#8a7556"];
    for (const side of [-1, 1]) {
      for (let bay = 0; bay < 6; bay++) {
        for (let level = 0; level < 3; level++) {
          for (let k = 0; k < 2; k++) {
            if (rnd() < 0.18) continue;
            const w = 0.55 + rnd() * 0.25;
            const h = 0.35 + rnd() * 0.25;
            out.push({
              p: [side * 2.55 + (rnd() - 0.5) * 0.15, 0.12 + level * 1.05 + h / 2, -6 + bay * 2.2 + (k - 0.5) * 0.85],
              s: [0.8, h, w],
              c: tones[Math.floor(rnd() * tones.length)]!,
            });
          }
        }
      }
    }
    return out;
  }, []);

  const uprights = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const side of [-1, 1]) for (let bay = 0; bay <= 6; bay++) for (const d of [-0.5, 0.5]) out.push([side * 2.55 + d, 1.6, -7.1 + bay * 2.2]);
    return out;
  }, []);
  const beams = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const side of [-1, 1]) for (let bay = 0; bay < 6; bay++) for (let level = 0; level < 4; level++) for (const d of [-0.5, 0.5]) out.push([side * 2.55 + d, 0.08 + level * 1.05, -6 + bay * 2.2]);
    return out;
  }, []);

  return (
    <group>
      <Instances limit={uprights.length} castShadow receiveShadow>
        <boxGeometry args={[0.07, 3.2, 0.07]} />
        <meshStandardMaterial color="#c2421d" metalness={0.4} roughness={0.5} />
        {uprights.map((p, i) => (
          <Instance key={i} position={p} />
        ))}
      </Instances>
      <Instances limit={beams.length} castShadow receiveShadow>
        <boxGeometry args={[0.06, 0.08, 2.2]} />
        <meshStandardMaterial color="#3d4148" metalness={0.6} roughness={0.4} />
        {beams.map((p, i) => (
          <Instance key={i} position={p} />
        ))}
      </Instances>
      <Instances limit={cartons.length} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.95} />
        {cartons.map((c, i) => (
          <Instance key={i} position={c.p} scale={c.s} color={c.c} />
        ))}
      </Instances>
    </group>
  );
}

/** The machine panel the robot inspects. `glowRef` 0..1 lights its screen. */
export const Panel = forwardRef<THREE.Group, { glowRef: React.MutableRefObject<number>; alarmRef: React.MutableRefObject<number> }>(
  function Panel({ glowRef, alarmRef }, ref) {
    const screen = useRef<THREE.MeshStandardMaterial>(null);
    const warn = useRef<THREE.MeshStandardMaterial>(null);
    useFrame(() => {
      if (screen.current) screen.current.emissiveIntensity = 0.25 + glowRef.current * 2.2;
      if (warn.current) warn.current.emissiveIntensity = alarmRef.current * (1.5 + Math.sin(performance.now() / 160) * 1.2);
    });
    return (
      <group ref={ref} position={PANEL_POS}>
        <RoundedBox args={[1.6, 1.9, 0.5]} radius={0.05} position={[0, 0.95, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#30343a" metalness={0.5} roughness={0.45} />
        </RoundedBox>
        <mesh position={[-0.2, 1.25, 0.26]}>
          <planeGeometry args={[0.9, 0.55]} />
          <meshStandardMaterial ref={screen} color="#0c1a17" emissive="#2ee6a6" emissiveIntensity={0.25} toneMapped={false} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0.5, 1.4 - i * 0.18, 0.26]}>
            <circleGeometry args={[0.045, 24]} />
            <meshStandardMaterial color="#222" emissive={i === 0 ? "#ff4a1f" : "#5c6066"} emissiveIntensity={i === 0 ? 1.2 : 0.3} toneMapped={false} />
          </mesh>
        ))}
        {/* the obstruction the vision specialist reports: a carton leaning on the panel vent */}
        <mesh position={[0.35, 0.38, 0.45]} rotation={[0, 0.3, -0.12]} castShadow>
          <boxGeometry args={[0.5, 0.6, 0.4]} />
          <meshStandardMaterial color="#7d6a50" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.25, 0.26]}>
          <planeGeometry args={[1.3, 0.22]} />
          <meshStandardMaterial ref={warn} color="#200" emissive="#ff2238" emissiveIntensity={0} toneMapped={false} />
        </mesh>
      </group>
    );
  },
);

export function Floor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#141517" roughness={0.85} metalness={0.1} />
      </mesh>
      <Grid
        position={[0, 0.002, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#2a2c30"
        sectionSize={2.2}
        sectionThickness={1}
        sectionColor="#3a3d42"
        fadeDistance={22}
        fadeStrength={1.5}
        infiniteGrid
      />
      {/* aisle safety lines */}
      {[-1.35, 1.35].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, -1]}>
          <planeGeometry args={[0.07, 14]} />
          <meshStandardMaterial color="#e8b21c" emissive="#e8b21c" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

export function Warehouse({ glowRef, alarmRef }: { glowRef: React.MutableRefObject<number>; alarmRef: React.MutableRefObject<number> }) {
  return (
    <group>
      <Floor />
      <Racks />
      <Panel glowRef={glowRef} alarmRef={alarmRef} />
    </group>
  );
}
