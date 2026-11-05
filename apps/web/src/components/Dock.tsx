"use client";
/**
 * Top dock (macOS-style): icons grow toward the pointer, a label rises on hover or focus, a dot
 * marks where you are. Plain links underneath, so keyboard and screen readers get a normal nav.
 * Reduced motion and touch: no magnification.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";

const I = {
  network: (
    <g><circle cx="12" cy="12" r="2.6" /><circle cx="5" cy="7" r="1.7" /><circle cx="19" cy="7" r="1.7" /><circle cx="7" cy="19" r="1.7" /><circle cx="18" cy="17.5" r="1.7" /><path d="M10 10.8 6.4 8M14 10.8 17.6 8M10.6 14.2 8 17.6M14.2 13.4l2.6 2.8" /></g>
  ),
  console: (
    <g><rect x="3.5" y="5" width="17" height="14" rx="3.5" /><path d="M7.5 10l2.5 2-2.5 2M12.5 14.5h4" /></g>
  ),
  choose: (
    <g><path d="M4 7h9M4 12h6M4 17h11" /><circle cx="17" cy="7" r="2.2" /><circle cx="13.5" cy="12" r="2.2" /><path d="m17.5 15.5 1.6 1.6 2.4-2.8" /></g>
  ),
  agents: (
    <g><rect x="4" y="4" width="7" height="7" rx="2.2" /><rect x="13" y="4" width="7" height="7" rx="2.2" /><rect x="4" y="13" width="7" height="7" rx="2.2" /><rect x="13" y="13" width="7" height="7" rx="2.2" /></g>
  ),
  trust: (
    <g><path d="M12 3.6 5.5 6.4v5.2c0 3.9 2.7 7.1 6.5 8.6 3.8-1.5 6.5-4.7 6.5-8.6V6.4L12 3.6Z" /><path d="m9.3 12.2 1.9 1.9 3.6-3.8" /></g>
  ),
  publish: (
    <g><path d="M12 15V4.5M8 8.2l4-3.7 4 3.7" /><path d="M5 13.5v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" /></g>
  ),
  quote: (
    <g><rect x="5" y="3.5" width="14" height="17" rx="3.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></g>
  ),
  add: (
    <g><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8.5v7M8.5 12h7" /></g>
  ),
  admin: (
    <g><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19.5c.9-3 3.5-4.6 6.5-4.6s5.6 1.6 6.5 4.6" /></g>
  ),
};

type Item = { id: string; href: string; label: string; icon: keyof typeof I; section?: string };
const ITEMS: Item[] = [
  { id: "network", href: "/#top", label: "Network", icon: "network", section: "top" },
  { id: "console", href: "/#console", label: "Console", icon: "console", section: "console" },
  { id: "choose", href: "/#choose", label: "How robots choose", icon: "choose", section: "choose" },
  { id: "trust", href: "/#trust", label: "Privacy and safety", icon: "trust", section: "trust" },
  { id: "agents", href: "/agents", label: "Agent market", icon: "agents" },
  { id: "quote", href: "/quote", label: "Get a quote", icon: "quote" },
];
const OPS: Item[] = [
  { id: "register", href: "/robots/new", label: "Register a robot", icon: "add" },
  { id: "admin", href: "/admin", label: "Your dashboard", icon: "admin" },
];

function DockIcon({ item, mouseX, active, magnify }: { item: Item; mouseX: MotionValue<number>; active: boolean; magnify: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : Infinity;
  });
  const size = useSpring(useTransform(dist, [-140, 0, 140], [40, magnify ? 58 : 40, 40]), { mass: 0.12, stiffness: 180, damping: 14 });
  const glyph = useTransform(size, (s) => s * 0.5);
  return (
    <motion.div className="dock__cell" style={{ width: size, height: size }}>
      <Link ref={ref} href={item.href} className={`dock__btn ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
        <motion.svg viewBox="0 0 24 24" style={{ width: glyph, height: glyph }} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {I[item.icon]}
        </motion.svg>
        <span className="dock__label">{item.label}</span>
      </Link>
      {active && <motion.span layoutId="dock-dot" className="dock__dot" transition={{ type: "spring", stiffness: 500, damping: 34 }} />}
    </motion.div>
  );
}

export function Dock() {
  const path = usePathname();
  const mouseX = useMotionValue(Infinity);
  const [section, setSection] = useState<string>("top");
  const [magnify, setMagnify] = useState(true);

  useEffect(() => {
    setMagnify(window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches);
  }, []);

  useEffect(() => {
    if (path !== "/") return;
    const ids = ITEMS.map((i) => i.section).filter(Boolean) as string[];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setSection(vis.target.id);
      },
      { threshold: [0.25, 0.5] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);

  const isActive = (it: Item) => (it.section ? path === "/" && section === it.section : path.startsWith(it.href));

  return (
    <header className="dock-wrap">
      <a className="skip" href="#main">Skip to content</a>
      <nav className="dock" aria-label="Main" onMouseMove={(e) => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}>
        <Link href="/" className="dock__brand" aria-label="Semmal home">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="dock__mark">
            <circle cx="12" cy="12" r="3.4" fill="var(--p-accent)" />
            <circle cx="4.6" cy="6.4" r="1.9" fill="currentColor" />
            <circle cx="19.4" cy="6.4" r="1.9" fill="currentColor" />
            <circle cx="12" cy="20.6" r="1.9" fill="currentColor" />
            <path d="M12 12 4.6 6.4M12 12l7.4-5.6M12 12v8.6" stroke="currentColor" strokeWidth="1.3" opacity=".5" strokeLinecap="round" />
          </svg>
          <span>Semmal</span>
        </Link>
        <span className="dock__sep" aria-hidden="true" />
        {ITEMS.map((it) => (
          <DockIcon key={it.id} item={it} mouseX={mouseX} active={isActive(it)} magnify={magnify} />
        ))}
        <span className="dock__sep" aria-hidden="true" />
        {OPS.map((it) => (
          <DockIcon key={it.id} item={it} mouseX={mouseX} active={isActive(it)} magnify={magnify} />
        ))}
        <Link href="/agents" className="btn btn--primary dock__cta">Browse agents</Link>
      </nav>
    </header>
  );
}
