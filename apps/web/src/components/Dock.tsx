"use client";
/**
 * Top dock (macOS-style): icons grow toward the pointer, a label rises on hover or focus, a dot
 * marks where you are. Plain links underneath, so keyboard and screen readers get a normal nav.
 * Reduced motion and touch: no magnification.
 */
import Link from "next/link";
import { NotificationBell } from "./NotificationBell";
import { Logo } from "./brand/Logo";
import { AccountButton } from "./AccountButton";
import { usePathname } from "next/navigation";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";

const I = {
  agents: (
    <g><rect x="4" y="4" width="7" height="7" rx="2.2" /><rect x="13" y="4" width="7" height="7" rx="2.2" /><rect x="4" y="13" width="7" height="7" rx="2.2" /><rect x="13" y="13" width="7" height="7" rx="2.2" /></g>
  ),
  quote: (
    <g><rect x="5" y="3.5" width="14" height="17" rx="3.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></g>
  ),
  add: (
    <g><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8.5v7M8.5 12h7" /></g>
  ),
  orders: (
    <g><path d="M5 7.5h14l-1.3 9.2a2.5 2.5 0 0 1-2.5 2.1H8.8a2.5 2.5 0 0 1-2.5-2.1L5 7.5Z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></g>
  ),
  admin: (
    <g><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19.5c.9-3 3.5-4.6 6.5-4.6s5.6 1.6 6.5 4.6" /></g>
  ),
};

type Item = { id: string; href: string; label: string; icon: keyof typeof I };
// what people come for: find agents, book a robot, follow their orders; then what owners do
const ITEMS: Item[] = [
  { id: "agents", href: "/agents", label: "Agent market", icon: "agents" },
  { id: "quote", href: "/quote", label: "Book a robot", icon: "quote" },
  { id: "orders", href: "/orders", label: "Your orders", icon: "orders" },
];
const OPS: Item[] = [
  { id: "register", href: "/robots/new", label: "Register a robot", icon: "add" },
  { id: "admin", href: "/admin", label: "Your dashboard", icon: "admin" },
];

function DockIcon({ item, mouseX, active, magnify, ops }: { item: Item; mouseX: MotionValue<number>; active: boolean; magnify: boolean; ops?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : Infinity;
  });
  const size = useSpring(useTransform(dist, [-120, 0, 120], [36, magnify ? 48 : 36, 36]), { mass: 0.12, stiffness: 180, damping: 14 });
  const glyph = useTransform(size, (s) => s * 0.5);
  return (
    <motion.div className={`dock__cell ${ops ? "dock__ops" : ""}`} style={{ width: size, height: size }}>
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
  const [magnify, setMagnify] = useState(true);

  useEffect(() => {
    setMagnify(window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches);
  }, []);

  const isActive = (it: Item) => path.startsWith(it.href);

  return (
    <header className="dock-wrap">
      <a className="skip" href="#main">Skip to content</a>
      <nav className="dock" aria-label="Main" onMouseMove={(e) => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}>
        <Link href="/" className="dock__brand" aria-label="Semmal (செம்மல்) home">
          <Logo />
        </Link>
        <span className="dock__sep" aria-hidden="true" />
        {ITEMS.map((it) => (
          <DockIcon key={it.id} item={it} mouseX={mouseX} active={isActive(it)} magnify={magnify} />
        ))}
        <span className="dock__sep dock__ops" aria-hidden="true" />
        {OPS.map((it) => (
          <DockIcon key={it.id} item={it} mouseX={mouseX} active={isActive(it)} magnify={magnify} ops />
        ))}
        <NotificationBell />
        <AccountButton />
      </nav>
    </header>
  );
}
