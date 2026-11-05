"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { AgentListing, Listing, RobotProfile } from "@/lib/api";
import type { NamedEntry } from "./graph";

const AgentWorld = dynamic(() => import("./AgentWorld"), {
  ssr: false,
  loading: () => <div className="world-canvas world-canvas--poster" aria-hidden="true" />,
});

const CHAPTERS = [
  {
    n: "01",
    title: "Robots and agents in one registry",
    body: "Every robot and specialist agent is an Arkiv entity with its capabilities, price and the trust mode it needs. Anyone can read it; only its owner can change it.",
  },
  {
    n: "02",
    title: "The robot does its own hiring",
    body: "Rover 01 takes a panel inspection. It filters the registry by capability, price and trust mode, then hires a vision and an inspection agent inside its budget.",
  },
  {
    n: "03",
    title: "Inference stays inside the enclave",
    body: "The vision agent sends one minimised keyframe to 0G in private mode. If no private provider is free, the call fails instead of quietly downgrading.",
  },
  {
    n: "04",
    title: "Every job ends as a record",
    body: "Decisions, request IDs and incidents are indexed on Arkiv. A motor fault still stops the robot locally first, with no network and no AI.",
  },
];

export function WorldSection() {
  const section = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [active, setActive] = useState(-1);
  const [names, setNames] = useState<{ robots: NamedEntry[]; agents: NamedEntry[] } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/robots").then((r) => r.json() as Promise<Listing<RobotProfile>>),
      fetch("/api/agents").then((r) => r.json() as Promise<Listing<AgentListing>>),
    ])
      .then(([r, a]) =>
        setNames({
          robots: r.items.map((e) => ({ label: e.data.displayName, sub: e.data.pricing ? `Robot · quotes ${e.data.pricing.minFee}–${e.data.pricing.maxQuote} USDC a task` : `Robot · ${e.data.price?.amount ?? "?"} USDC a task`, kind: "robot" })),
          agents: a.items.map((e) => ({
            label: e.data.displayName,
            sub: `${e.data.kind} · ${e.data.price.amount} ${e.data.price.token} · ${e.data.inference?.trustMode ?? "no inference"} · ${e.provenance}`,
            kind: e.data.kind,
          })),
        }),
      )
      .catch(() => setNames({ robots: [], agents: [] }));
  }, []);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      trigger: section.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        progress.current = self.progress;
        const p = self.progress;
        const next = p < 0.12 ? -1 : p < 0.34 ? 0 : p < 0.58 ? 1 : p < 0.82 ? 2 : 3;
        setActive((a) => (a === next ? a : next));
      },
    });
    return () => st.kill();
  }, []);

  const robots = useMemo(() => names?.robots ?? [], [names]);
  const agents = useMemo(() => names?.agents ?? [], [names]);

  return (
    <section ref={section} id="top" className="world" style={{ ["--h" as string]: 5, ["--hm" as string]: 5 }} aria-labelledby="hero-h">
      <div className="world__stage">
        <div aria-hidden="true">{names && <AgentWorld progress={progress} robots={robots} agents={agents} />}</div>
        <nav className="world__ticks" aria-label="Chapters">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.n}
              type="button"
              className={i === active ? "is-on" : ""}
              aria-label={`Chapter ${i + 1}: ${c.title}`}
              aria-current={i === active ? "step" : undefined}
              onClick={() => {
                const el = section.current;
                if (!el) return;
                const top = el.getBoundingClientRect().top + window.scrollY;
                window.scrollTo({ top: top + (i + 1) * window.innerHeight + 2, behavior: "smooth" });
              }}
            >
              <span>{c.title}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="world__flow">
        <div className="world__hero">
          <div className="wrap">
            <div className="world__hero-text">
              <p className="world__eyebrow">Robot-as-a-service on 0G and Arkiv</p>
              <h1 id="hero-h">A private network where robots hire AI agents</h1>
              <p className="hero__lead">
                Book a robot for a task. It finds, hires and pays its own specialist agents, runs private inference on 0G and records
                every job on Arkiv.
              </p>
              <div className="btn-row">
                <Link className="btn btn--primary" href="/agents">Browse the agent market</Link>
                <a className="btn btn--secondary" href="#chapters">See a mission run</a>
              </div>
              <p className="world__fact">Rover 01 from 12.50 USDC a task. It stops safely even with no network.</p>
            </div>
          </div>
        </div>

        <div id="chapters">
          {CHAPTERS.map((c, i) => (
            <div key={c.n} className="world__chapter">
              <div className="wrap">
                <article className={`chapter ${i === active ? "is-active" : ""}`}>
                  <span className="chapter__n">Step {i + 1} of 4</span>
                  <h2 className="chapter__title">{c.title}</h2>
                  <p>{c.body}</p>
                </article>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
