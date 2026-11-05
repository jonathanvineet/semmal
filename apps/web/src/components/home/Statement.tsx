"use client";
/**
 * The page's big scene, from the taste-skill kit (assets/scenes/dot-becomes-the-full-stop),
 * mounted by the kit's own runtime (public/kit/scenes/scenes.js). Native scroll; under reduced
 * motion, without script or if the module fails, the claim shows as a plain statement.
 */
import { useEffect, useRef } from "react";

export function Statement() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    (window as { __scenesManual?: boolean }).__scenesManual = true;
    let api: { mountAll?: (r?: ParentNode) => Promise<unknown>; unmountAll?: (r?: ParentNode) => void } | null = null;
    const url = "/kit/scenes/scenes.js";
    import(/* webpackIgnore: true */ url)
      .then((m) => {
        api = m.default ?? m;
        if (alive && ref.current?.parentElement) api?.mountAll?.(ref.current.parentElement);
      })
      .catch(() => ref.current?.classList.add("sc", "is-rest"));
    return () => {
      alive = false;
      if (ref.current?.parentElement) api?.unmountAll?.(ref.current.parentElement);
    };
  }, []);
  return (
    <section
      ref={ref}
      className="sc"
      data-big-scene="dot-becomes-the-full-stop"
      data-big-scene-opts='{"cut": false, "hold": 1}'
      style={{ ["--h" as string]: 1 }}
      aria-labelledby="dfs-h"
    >
      <div className="sc__stage">
        <h2 className="dfs__line" id="dfs-h">The robot does the hiring.</h2>
        <p className="dfs__sub muted">The marketplace assigns the task. Every hire after that is the robot&apos;s own decision, inside its budget.</p>
      </div>
    </section>
  );
}
