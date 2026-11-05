"use client";
/**
 * The page's one big scene: the stage sticks while the visitor scrolls through four chapters.
 * Native scroll only. Under reduced motion, or on phones, the finished composition shows
 * with every chapter as plain text.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const SceneCanvas = dynamic(() => import("./three/SceneCanvas"), { ssr: false });

const CHAPTERS = [
  {
    n: "01",
    title: "The marketplace assigns one robot",
    body: "A customer books a panel inspection. The marketplace finds Rover 01 in the Arkiv registry, checks it is free, and hands it the task with a budget.",
  },
  {
    n: "02",
    title: "The robot hires its own specialists",
    body: "Rover 01 queries the agent registry, filters by capability, price and trust mode, and hires a vision and an inspection agent. The marketplace never chooses for it.",
  },
  {
    n: "03",
    title: "Private inference at the checkpoint",
    body: "At the panel the vision agent sends one keyframe to 0G in private mode. The answer is checked against a strict schema before the robot acts on it.",
  },
  {
    n: "04",
    title: "A motor fault stops it locally",
    body: "Left motor overcurrent: the safety supervisor stops the wheels with no network and no AI. The incident is saved on the robot, then indexed on Arkiv.",
  },
];

export function MissionSection() {
  const section = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"live" | "still">("live");

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 767px)");
    const apply = () => setMode(still.matches ? "still" : "live");
    apply();
    still.addEventListener("change", apply);
    return () => still.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (mode === "still") {
      progress.current = 1;
      setActive(3);
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      trigger: section.current,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        progress.current = self.progress;
        const next = self.progress < 0.25 ? 0 : self.progress < 0.5 ? 1 : self.progress < 0.78 ? 2 : 3;
        setActive((a) => (a === next ? a : next));
      },
    });
    return () => st.kill();
  }, [mode]);

  return (
    <section ref={section} id="mission" className={`mission mission--${mode}`} aria-labelledby="mission-h">
      <div className="mission__stage">
        <div className="mission__canvas">{mode === "live" ? <SceneCanvas progress={progress} /> : <SceneCanvas progress={progress} still />}</div>
        <div className="wrap mission__copy">
          <h2 id="mission-h">One inspection, start to finish</h2>
          <ol className="mission__steps">
            {CHAPTERS.map((c, i) => (
              <li key={c.n} className={i === active || mode === "still" ? "is-active" : ""} aria-current={i === active ? "step" : undefined}>
                <span className="mission__n mono">{c.n}</span>
                <div>
                  <h3 className="t-card">{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mission__sim mono">SIMULATION · Gazebo-style warehouse, not physical hardware</p>
        </div>
      </div>
    </section>
  );
}
