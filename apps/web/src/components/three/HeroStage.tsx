"use client";
/** Hero stage: the rover, whole and large, turning slowly; three spec hotspots. */
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Html } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Robot, type RobotState } from "./Robot";
import { Floor } from "./Warehouse";

const SPOTS = [
  { id: "lidar", pos: [0, 0.62, -0.18] as [number, number, number], title: "2D lidar", body: "360° scan for the local planner and the safety stop. Works with the network down." },
  { id: "camera", pos: [0, 1.0, 0.0] as [number, number, number], title: "Inspection camera", body: "Sends one minimised keyframe per checkpoint, never a video stream." },
  { id: "drive", pos: [0.52, 0.2, 0.08] as [number, number, number], title: "Differential drive", body: "Motor current and temperature watched locally; a fault latches an emergency stop." },
];

function Turntable({ reduced }: { reduced: boolean }) {
  const g = useRef<THREE.Group>(null);
  const state = useRef<RobotState>("normal");
  const speed = useRef(0);
  const [open, setOpen] = useState<string | null>(null);
  useFrame((s, dt) => {
    if (!g.current) return;
    if (!reduced && !open) g.current.rotation.y += dt * 0.18;
    const tx = s.pointer.x * 0.25;
    const ty = s.pointer.y * 0.08;
    s.camera.position.x = THREE.MathUtils.damp(s.camera.position.x, 2.1 + tx, 3, dt);
    s.camera.position.y = THREE.MathUtils.damp(s.camera.position.y, 1.25 + ty, 3, dt);
    s.camera.lookAt(0, 0.48, 0);
  });
  return (
    <group ref={g} rotation={[0, -0.7, 0]}>
      <Robot stateRef={state} speedRef={speed} scale={1.15} />
      {SPOTS.map((sp) => (
        <Html key={sp.id} position={sp.pos.map((v) => v * 1.15) as [number, number, number]} center zIndexRange={[5, 0]}>
          <div className={`spot ${open === sp.id ? "is-open" : ""}`}>
            <button
              type="button"
              className="spot__disc"
              aria-label={sp.title}
              aria-expanded={open === sp.id}
              onPointerEnter={() => setOpen(sp.id)}
              onPointerLeave={() => setOpen(null)}
              onFocus={() => setOpen(sp.id)}
              onBlur={() => setOpen(null)}
              onClick={() => setOpen((o) => (o === sp.id ? null : sp.id))}
            />
            <div className="spot__card" role="tooltip">
              <span className="t-card">{sp.title}</span>
              <span className="t-small">{sp.body}</span>
            </div>
          </div>
        </Html>
      ))}
    </group>
  );
}

export default function HeroStage() {
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "100px" });
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={host} className="hero-canvas" aria-label="3D model of the Semmal Rover 01" role="img">
      <Canvas shadows dpr={[1, 2]} frameloop={visible ? "always" : "never"} camera={{ position: [2.1, 1.25, 2.6], fov: 34 }} gl={{ antialias: true }}>
        <fog attach="fog" args={["#18191b", 5, 12]} />
        <hemisphereLight args={["#e8eaee", "#18191b", 0.6]} />
        <directionalLight position={[3, 5, 2]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-4, 2, -3]} intensity={1.4} color="#ff6a3d" />
        <spotLight position={[0, 4, 0]} angle={0.5} penumbra={0.8} intensity={14} castShadow />
        <Floor />
        <Turntable reduced={reduced} />
        <ContactShadows position={[0, 0.005, 0]} opacity={0.75} scale={6} blur={2} far={2} />
      </Canvas>
    </div>
  );
}
