import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is for the Docker runner, which has no pnpm/next CLI.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  agentRules: false,
  allowedDevOrigins: ['192.168.99.203'],
};

export default nextConfig;
