import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Standalone output is for the Docker runner, which has no pnpm/next CLI.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  agentRules: false,
  allowedDevOrigins: ['192.168.99.203'],
};

// No-arg form auto-discovers ./src/i18n/request.ts.
// Never pass an absolute path here — Turbopack rejects it.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
