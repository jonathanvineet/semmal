import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three", "@semmal/contracts", "@semmal/arkiv-adapter"],
  // The browser talks only to the SEMMAL API. Keys never reach the client bundle.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001"}/api/:path*` }];
  },
};
export default config;
