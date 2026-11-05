"use client";
/**
 * The agent network behind every page except home (which has its own scroll-driven version).
 * One fixed, dimmed, non-interactive canvas that survives navigation between pages; it pauses
 * when the tab is hidden and holds still under reduced motion.
 */
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AgentWorld = dynamic(() => import("./AgentWorld"), { ssr: false });

// a wide, slightly high view of the whole network (the first chapter's shot)
const OVERVIEW = 0.22;

export function AmbientBackdrop() {
  const path = usePathname();
  const progress = useRef(OVERVIEW);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  if (path === "/") return null;
  return (
    <div className="backdrop" aria-hidden="true">
      {!hidden && <AgentWorld progress={progress} robots={[]} agents={[]} ambient />}
      <div className="backdrop__veil" />
    </div>
  );
}
