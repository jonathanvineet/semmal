"use client";
/**
 * Real robot geometry (adapted from MuJoCo Menagerie, see /credits) rendered in one shared canvas:
 * each card is a drei <View>, so seven robots cost one WebGL context. Every model gets the same
 * obsidian studio finish: glossy graphite, a warm accent part, orange and ice rim lights, soft
 * contact shadow. The model turns slowly, leans toward the pointer and lifts when its card is active.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, PerspectiveCamera, useGLTF, View } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

const OBSIDIAN = () => new THREE.MeshPhysicalMaterial({ color: "#17181c", roughness: 0.28, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.18 });
const SATIN = () => new THREE.MeshPhysicalMaterial({ color: "#3a3d45", roughness: 0.42, metalness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3 });
const ACCENT = () => new THREE.MeshPhysicalMaterial({ color: "#ff7a4a", roughness: 0.35, metalness: 0.2, clearcoat: 0.8, emissive: new THREE.Color("#ff5a2a"), emissiveIntensity: 0.18 });
/** Per-model framing: some robots need turning upright or a closer camera. */
const FRAME: Record<string, { rot?: [number, number, number]; zoom?: number; camY?: number }> = {
  hand: { rot: [0, 0, Math.PI / 2], zoom: 1.0, camY: 0.45 },
  drone: { zoom: 1.1, camY: 0.95 },
  rover: { zoom: 1.0, camY: 0.7 },
  manipulator: { zoom: 1.05 },
};

const PALE = () => new THREE.MeshPhysicalMaterial({ color: "#d9d6d0", roughness: 0.45, metalness: 0.1, clearcoat: 0.7 });

function Model({ asset, active, tilt = 0.18 }: { asset: string; active: boolean; tilt?: number }) {
  const { scene } = useGLTF(`/models/${asset}.glb`, false, true);
  const group = useRef<THREE.Group>(null);
  const styled = useMemo(() => {
    const root = scene.clone(true);
    const f = FRAME[asset];
    if (f?.rot) root.rotation.set(...f.rot);
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const size = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count);
    meshes.sort((a, b) => size(b) - size(a));
    // the biggest part is the body; the next carries the accent; small parts get satin or pale trim
    meshes.forEach((m, i) => {
      m.geometry.computeVertexNormals();
      m.material = i === 0 ? OBSIDIAN() : i === 1 ? ACCENT() : i % 2 ? SATIN() : PALE();
      m.castShadow = true;
    });
    if (meshes.length === 1) meshes[0]!.material = OBSIDIAN();
    const wrap = new THREE.Group();
    wrap.add(root);
    const box = new THREE.Box3().setFromObject(wrap);
    const c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z);
    // fit by every dimension, not just the largest: tall robots (humanoid, arm) get the most room
    // to spare so the hover lift and pointer tilt never reach the frame's edge
    const dim = box.getSize(new THREE.Vector3());
    const fit = Math.min(0.74 / dim.y, 0.95 / Math.max(dim.x, dim.z));
    wrap.scale.setScalar(fit);
    const h = dim.y * fit;
    return { root: wrap, h };
  }, [scene, asset]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) g.rotation.y += dt * (active ? 0.55 : 0.22);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * tilt * 0.2, 4, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, active ? 0.015 : 0, 5, dt) + (reduced ? 0 : Math.sin(state.clock.elapsedTime * 1.4) * 0.003);
  });

  return (
    <>
      <group ref={group}>
        <group position={[0, -styled.h / 2, 0]}>
          <primitive object={styled.root} />
        </group>
      </group>
      <ContactShadows position={[0, -styled.h / 2 - 0.005, 0]} opacity={0.6} scale={2.4} blur={2.6} far={1.2} color="#000000" />
    </>
  );
}

/** One robot inside a card. Place it anywhere in the page; it draws into the shared canvas. */
export function RobotView({ asset, active = false, className, zoom = 1 }: { asset: string; active?: boolean; className?: string; zoom?: number }) {
  const f = FRAME[asset];
  const z = zoom * (f?.zoom ?? 1);
  return (
    <View className={className}>
      <PerspectiveCamera makeDefault position={[1.35 / z, (f?.camY ?? 0.55) / z, 1.6 / z]} fov={30} onUpdate={(c) => c.lookAt(0, 0.02, 0)} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2.5, 1.2, -1.5]} intensity={2.2} color="#ff7a4a" />
      <directionalLight position={[2.5, 0.8, -2]} intensity={1.6} color="#8fd8ff" />
      <Environment resolution={64}>
        <Lightformer form="rect" intensity={2} position={[0, 3, 1]} scale={[4, 1, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#ff7a4a" position={[-3, 0.5, -1]} scale={[1, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#8fd8ff" position={[3, 0.5, -1]} scale={[1, 3, 1]} />
        <Lightformer form="ring" intensity={0.8} position={[0, 0.4, 3]} scale={1.5} />
      </Environment>
      <Suspense fallback={null}>
        <Model asset={asset} active={active} />
      </Suspense>
    </View>
  );
}

/** Mount once per page that shows robots: the shared canvas every RobotView draws into. */
export function RobotCanvas() {
  return (
    <Canvas
      className="robot-canvas"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      eventSource={typeof document !== "undefined" ? document.body : undefined}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 5 }}
    >
      <View.Port />
    </Canvas>
  );
}

export const preloadRobots = (assets: string[]) => assets.forEach((a) => useGLTF.preload(`/models/${a}.glb`, false, true));
