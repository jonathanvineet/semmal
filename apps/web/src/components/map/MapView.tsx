"use client";
import dynamic from "next/dynamic";

/** The map, loaded in the browser only (Leaflet needs window). */
export const MapView = dynamic(() => import("./LeafletMap"), { ssr: false, loading: () => <div className="smap smap--loading" aria-busy="true" /> });
export type { MapRobot, Pt } from "./LeafletMap";
