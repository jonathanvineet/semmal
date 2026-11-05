import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three", "@semmal/contracts", "@semmal/arkiv-adapter"],
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
