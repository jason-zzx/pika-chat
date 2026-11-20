import type { locales } from "@/i18n/locales";

import messages from "../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: typeof messages;
  }
}

declare global {
  interface PikaNative {
    serverName: string;
    appVersion?: string;
    notify(input: { title: string; body: string; path: string }): void;
    showServerMenu(anchor: { x: number; y: number }): void;
    openServers(screen: "list" | "add"): void;
  }

  interface Window {
    pikaNative?: PikaNative;
  }
}
