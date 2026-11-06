import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/** This machine's own network addresses, so the dev site also works when opened by IP (e.g. from a phone). */
const localIps = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [...localIps, ...(process.env.WEB_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
  transpilePackages: ["three", "@semmal/contracts", "@semmal/arkiv-adapter", "@semmal/zerog-pay"],
  // The browser talks only to the SEMMAL API. Keys never reach the client bundle.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      // agent service endpoints as listed on Arkiv: /agents/<id>/jobs is served by the runner
      { source: "/agents/:agentId/jobs", destination: `${api}/api/agents/:agentId/jobs` },
    ];
  },
};
export default config;
