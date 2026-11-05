"use client";
import { useEffect, useState } from "react";

/** Shapes mirror @semmal/contracts; the browser only reads what the API returns. */
export type Provenance = "ARKIV" | "ZEROG_ROUTER" | "SIMULATED";

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
  hardware: { base: string; sensors: string[]; simulated: boolean };
  capabilities: string[];
  serviceArea: string;
  price: { amount: string; token: string; unit: string };
  profileVersion: number;
};

export type Entry<T> = {
  provenance: Provenance;
  entityKey?: string;
  owner?: string;
  creator?: string;
  expiresAtBlock?: string;
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

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(path)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return (await r.json()) as T;
      })
      .then((d) => live && setData(d))
      .catch(() => live && setError("The SEMMAL API is not reachable. Start it with pnpm dev:api."));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error, loading: !data && !error };
}

export const shortKey = (k?: string) => (k ? `${k.slice(0, 8)}…${k.slice(-6)}` : "");
