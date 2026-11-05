"use client";
import dynamic from "next/dynamic";

/** Client-only: WebGL never renders on the server. A still poster shows until it mounts. */
export const HeroCanvas = dynamic(() => import("./three/HeroStage"), {
  ssr: false,
  loading: () => <div className="hero-canvas hero-canvas--loading" aria-hidden="true" />,
});
