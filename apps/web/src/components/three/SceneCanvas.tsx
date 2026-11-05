"use client";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { MissionScene } from "./MissionScene";

export default function SceneCanvas({ progress }: { progress: React.MutableRefObject<number>; still?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "200px" });
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={host} style={{ position: "absolute", inset: 0 }} role="img" aria-label="Animated warehouse: the rover drives to a machine panel, inspects it, stops on a motor fault and records the incident">
      <Canvas shadows dpr={[1, 1.75]} frameloop={visible ? "always" : "never"} camera={{ position: [6.2, 4.4, 9.5], fov: 40 }}>
        <MissionScene progress={progress} />
      </Canvas>
    </div>
  );
}
