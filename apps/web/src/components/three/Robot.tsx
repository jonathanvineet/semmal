"use client";
/**
 * The SEMMAL rover, built from primitives so it needs no asset download.
 * It matches the simulated Gazebo base: differential drive, rear caster, 2D lidar puck,
 * camera mast. `state` drives the status light; `speed` spins the wheels.
 */
import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { forwardRef, useMemo, useRef } from "react";
import * as THREE from "three";

export type RobotState = "normal" | "scanning" | "estop";

const ACCENT = new THREE.Color("#ff4a1f");
const OK = new THREE.Color("#2ee6a6");
const STOP = new THREE.Color("#ff2238");

type Props = ThreeElements["group"] & {
  stateRef?: React.MutableRefObject<RobotState>;
  speedRef?: React.MutableRefObject<number>;
};

export const Robot = forwardRef<THREE.Group, Props>(function Robot({ stateRef, speedRef, ...props }, ref) {
  const lidar = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Group[]>([]);
  const light = useRef<THREE.MeshStandardMaterial>(null);
  const lens = useRef<THREE.MeshStandardMaterial>(null);
  const tmp = useMemo(() => new THREE.Color(), []);

  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b2e33", metalness: 0.55, roughness: 0.38 }), []);
  const deck = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3b3f45", metalness: 0.4, roughness: 0.5 }), []);
  const rubber = useMemo(() => new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.9 }), []);
  const orange = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff4a1f", metalness: 0.3, roughness: 0.4 }), []);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8c9097", metalness: 0.9, roughness: 0.25 }), []);

  useFrame((_, dt) => {
    const s = stateRef?.current ?? "normal";
    if (lidar.current && s !== "estop") lidar.current.rotation.y += dt * 6;
    const v = speedRef?.current ?? 0;
    wheels.current.forEach((w) => w && (w.rotation.x += v * dt * 6));
    if (light.current) {
      const target = s === "estop" ? STOP : s === "scanning" ? OK : ACCENT;
      tmp.copy(light.current.emissive).lerp(target, 1 - Math.exp(-dt * 8));
      light.current.emissive.copy(tmp);
      light.current.color.copy(tmp);
      const pulse = s === "estop" ? 2.2 + Math.sin(performance.now() / 120) * 1.4 : 2.4;
      light.current.emissiveIntensity = pulse;
    }
    if (lens.current) lens.current.emissiveIntensity = s === "scanning" ? 3 + Math.sin(performance.now() / 90) : 1.2;
  });

  const wheel = (x: number, i: number) => (
    <group key={i} position={[x, 0.17, 0.08]}>
      <group ref={(g) => { if (g) wheels.current[i] = g; }}>
        <mesh rotation={[0, 0, Math.PI / 2]} material={rubber} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.09, 40]} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} position={[x > 0 ? 0.047 : -0.047, 0, 0]} material={orange}>
          <cylinderGeometry args={[0.09, 0.09, 0.01, 32]} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <mesh key={k} position={[x > 0 ? 0.05 : -0.05, Math.cos((k / 6) * Math.PI * 2) * 0.13, Math.sin((k / 6) * Math.PI * 2) * 0.13]} material={steel}>
            <boxGeometry args={[0.012, 0.03, 0.03]} />
          </mesh>
        ))}
      </group>
    </group>
  );

  return (
    <group ref={ref} {...props}>
      {/* chassis */}
      <RoundedBox args={[0.86, 0.3, 0.78]} radius={0.07} smoothness={4} position={[0, 0.3, 0]} material={body} castShadow receiveShadow />
      <RoundedBox args={[0.74, 0.04, 0.66]} radius={0.02} smoothness={3} position={[0, 0.47, 0]} material={deck} castShadow />
      {/* front bumper */}
      <RoundedBox args={[0.88, 0.09, 0.08]} radius={0.03} smoothness={3} position={[0, 0.2, -0.4]} material={orange} castShadow />
      {/* status light strip, wraps the front and both sides */}
      <mesh position={[0, 0.36, -0.392]}>
        <boxGeometry args={[0.6, 0.025, 0.01]} />
        <meshStandardMaterial ref={light} color="#ff4a1f" emissive="#ff4a1f" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.432, 0.36, 0]}>
          <boxGeometry args={[0.01, 0.025, 0.5]} />
          <meshStandardMaterial color="#ff4a1f" emissive="#ff4a1f" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
      {wheel(0.47, 0)}
      {wheel(-0.47, 1)}
      {/* rear caster */}
      <mesh position={[0, 0.06, 0.3]} material={steel}>
        <sphereGeometry args={[0.06, 24, 16]} />
      </mesh>
      {/* lidar puck */}
      <group position={[0, 0.5, -0.18]}>
        <mesh material={steel} castShadow>
          <cylinderGeometry args={[0.1, 0.11, 0.05, 40]} />
        </mesh>
        <group ref={lidar} position={[0, 0.06, 0]}>
          <mesh material={body} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.07, 40]} />
          </mesh>
          <mesh position={[0, 0, -0.088]}>
            <boxGeometry args={[0.05, 0.02, 0.01]} />
            <meshStandardMaterial color="#ff4a1f" emissive="#ff4a1f" emissiveIntensity={3} toneMapped={false} />
          </mesh>
        </group>
      </group>
      {/* camera mast */}
      <mesh position={[0, 0.72, 0.12]} material={steel} castShadow>
        <cylinderGeometry args={[0.018, 0.022, 0.46, 16]} />
      </mesh>
      <group position={[0, 0.96, 0.08]}>
        <RoundedBox args={[0.22, 0.11, 0.12]} radius={0.025} smoothness={3} material={body} castShadow />
        <mesh position={[0, 0, -0.065]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.02, 32]} />
          <meshStandardMaterial ref={lens} color="#1a1c20" emissive="#ff6a3d" emissiveIntensity={1.2} metalness={0.9} roughness={0.1} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
});
