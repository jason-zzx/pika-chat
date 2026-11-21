import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Standalone output is for the Docker runner and desktop local server, which have no pnpm/next CLI.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  agentRules: false,
  allowedDevOrigins: ['192.168.99.203'],
  // Redirect /settings before RSC rendering so direct visits skip SettingsIndexPage's
  // thrown NEXT_REDIRECT (which trips React Flight dev performance.measure under clock skew).
  async redirects() {
    return [
      {
        source: "/settings",
        destination: "/settings/general",
        permanent: false,
      },
    ];
  },
};

// No-arg form auto-discovers ./src/i18n/request.ts.
// Never pass an absolute path here — Turbopack rejects it.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
