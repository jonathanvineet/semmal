"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/#robots", label: "Robots" },
  { href: "/agents", label: "Agents" },
  { href: "/#mission", label: "Mission" },
  { href: "/#registry", label: "Registry" },
];

export function Nav() {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  return (
    <header className="nav">
      <div className="wrap nav__bar">
        <a className="skip" href="#main">Skip to content</a>
        <Link className="nav__logo" href="/">
          <span className="mark" data-mark="stack" aria-hidden="true" />
          Semmal
        </Link>
        <nav className="nav__links" aria-label="Main">
          {LINKS.map((l) => (
            <div className="nav__item" key={l.href}>
              <Link className="nav__link" href={l.href} aria-current={path === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            </div>
          ))}
        </nav>
        <div className="nav__actions">
          <Link className="btn btn--primary" href="/agents">See specialist agents</Link>
        </div>
        <button className="nav__toggle" type="button" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu((m) => !m)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      {menu && (
        <div className="sheet" onClick={() => setMenu(false)}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
          <Link className="btn btn--primary" href="/agents">See specialist agents</Link>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer closing footer--dark">
      <div className="wrap">
        <div className="closing__cta">
          <h2>Robots that hire their own help</h2>
          <p className="t-lead muted measure">Book a robot for a task. It plans the work, hires the specialists it needs and stays accountable for the result.</p>
          <div className="btn-row">
            <Link className="btn btn--primary" href="/agents">See specialist agents</Link>
            <Link className="btn btn--secondary" href="/#mission">Watch the mission</Link>
          </div>
        </div>
        <div className="closing__links footer-row">
          <div>
            <span className="nav__logo"><span className="mark" data-mark="stack" aria-hidden="true" />Semmal</span>
            <p className="t-small muted measure">Robot-as-a-service marketplace and robot-agent economy. Simulation build.</p>
          </div>
          <div className="footer-cols">
            <div>
              <p className="t-label muted">Product</p>
              <Link href="/#robots">Robots</Link>
              <Link href="/agents">Agents</Link>
              <Link href="/#mission">Mission</Link>
              <Link href="/publish">Publish to Arkiv</Link>
            </div>
            <div>
              <p className="t-label muted">Built on</p>
              <a href="https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview" target="_blank" rel="noreferrer">0G Compute Router</a>
              <a href="https://arkiv.network/" target="_blank" rel="noreferrer">Arkiv</a>
              <a href="https://gazebosim.org/" target="_blank" rel="noreferrer">Gazebo</a>
            </div>
          </div>
        </div>
        <p className="legal t-small muted">© {new Date().getFullYear()} Semmal · SIMULATION · no real payments · Product names are trademarks of their owners</p>
      </div>
    </footer>
  );
}
