import Link from "next/link";
import { HeroCanvas } from "@/components/HeroCanvas";
import { MissionSection } from "@/components/MissionSection";
import { Marketplace } from "@/components/Marketplace";
import { RegistrySection, RobotsSection } from "@/components/Sections";

export default function Home() {
  return (
    <>
      <section className="hero hero--stage" aria-labelledby="hero-h">
        <div className="wrap hero-head">
          <h1 id="hero-h">Inspection robots for warehouses, hired by the task</h1>
          <div className="hero-side">
            <p className="t-lead">
              Book Rover 01 for a panel inspection. It hires its own vision and maintenance agents, runs private inference on 0G and
              records every incident on Arkiv.
            </p>
            <p className="hero-fact mono">From 12.50 USDC a task · emergency stop works offline</p>
            <div className="btn-row">
              <Link className="btn btn--primary" href="/agents">See specialist agents</Link>
              <Link className="btn btn--secondary" href="#mission">Watch the mission</Link>
            </div>
          </div>
        </div>
        <div className="hero-stage-3d">
          <HeroCanvas />
        </div>
      </section>

      <MissionSection />

      <RobotsSection />

      <section id="agents" className="section" style={{ ["--h" as string]: 1 }} aria-labelledby="agents-h">
        <div className="wrap">
          <div className="section-head section-head--split">
            <div>
              <h2 id="agents-h">Specialist agents <span className="muted">a robot can hire</span></h2>
            </div>
            <Link className="link" href="/agents">See all agents</Link>
          </div>
          <Marketplace limit={4} compact />
        </div>
      </section>

      <RegistrySection />
    </>
  );
}
