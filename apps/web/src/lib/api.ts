"use client";
import { useEffect, useState } from "react";

/** Shapes mirror @semmal/contracts; the browser only reads what the API returns. */
export type Provenance = "ARKIV" | "ZEROG_ROUTER";

export type AgentListing = {
  agentId: string;
  ownerWallet: string;
  displayName: string;
  kind: "vision" | "inspection" | "maintenance" | "navigation" | "delivery-verification";
  summary: string;
  endpoint: string;
  capabilities: { capabilityId: string; supportedRobotTypes: string[]; supportedTaskTypes: string[]; inputSchemaVersion: string; outputSchemaVersion: string }[];
  price: { amount: string; token: string; unit: string };
  inference?: { model: string; trustMode: "private" | "verified" | "standard" };
  delegation: { allowed: boolean; maxBudgetShare: number };
  serviceVersion: string;
};

export type RobotProfile = {
  robotId: string;
  displayName: string;
  robotType: string;
  robotWallet: string;
  ownerWallet: string;
  model: string;
  hardware: { base: string; sensors: string[] };
  capabilities: string[];
  serviceArea: string;
  location?: { lat: number; lon: number };
  serviceRadiusKm?: number;
  pricing?: { token: string; minFee: string; maxQuote: string; marginPct: number; maxSpendPerTask: string };
  price?: { amount: string; token: string; unit: string };
  profileVersion: number;
};

export type Entry<T> = {
  provenance: Provenance;
  entityKey?: string;
  owner?: string;
  creator?: string;
  expiresAtBlock?: string;
  /** Arkiv $createdAt (block number), when the API returns it. */
  createdAt?: string;
  data: T;
};

export type Listing<T> = { arkiv: { ok: boolean; count?: number; error?: string }; items: Entry<T>[] };

export type Status = {
  mode: string;
  arkiv: { network: string; chainId: number | null; expectedChainId: number; reachable: boolean; accessKeyConfigured: boolean; writerConfigured: boolean };
  zerog: {
    configured: boolean;
    baseUrlSet: boolean;
    requiredTrustMode?: string;
    visionModel?: { id: string; ok: boolean | null; status: string; reason?: string } | null;
    textModel?: { id: string; ok: boolean | null; status: string; reason?: string } | null;
    catalogError?: string;
  };
};

export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";

/** Fired after this browser publishes or removes something on Arkiv, so open lists reload. */
export const ARKIV_CHANGED = "semmal:arkiv-changed";
export const announceArkivChange = () => window.dispatchEvent(new Event(ARKIV_CHANGED));

export function useApi<T>(path: string, opts: { refreshMs?: number; onArkivChange?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(path)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return (await r.json()) as T;
      })
      .then((d) => live && (setData(d), setError(null)))
      .catch(() => live && setError("The SEMMAL API is not reachable. Start it with pnpm dev:api."));
    return () => {
      live = false;
    };
  }, [path, tick]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const again = () => setTick((t) => t + 1);
    // Arkiv indexes a new entity within seconds and the API caches lists for 15 s: reload a few times
    const onChange = () => [3_000, 10_000, 20_000].forEach((ms) => timers.push(setTimeout(again, ms)));
    if (opts.onArkivChange) window.addEventListener(ARKIV_CHANGED, onChange);
    const every = opts.refreshMs ? setInterval(again, opts.refreshMs) : undefined;
    return () => {
      window.removeEventListener(ARKIV_CHANGED, onChange);
      if (every) clearInterval(every);
      timers.forEach(clearTimeout);
    };
  }, [opts.onArkivChange, opts.refreshMs]);
  return { data, error, loading: !data && !error };
}

export const shortKey = (k?: string) => (k ? `${k.slice(0, 8)}…${k.slice(-6)}` : "");
