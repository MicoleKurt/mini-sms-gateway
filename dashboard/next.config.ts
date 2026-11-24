import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs the self-contained server from .next/standalone.
  output: "standalone",
  // Pin the project root to this directory. Otherwise Next.js looks for a
  // lockfile further up the tree, and the layout of the standalone output
  // would depend on what happens to be in a parent directory.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // "next dev" would otherwise write an AGENTS.md file into the project when
  // it detects an AI coding tool. The repository should not change by itself.
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
