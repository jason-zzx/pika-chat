import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// Colors are the default preset's light `--background` (oklch(0.985 0 0));
// the manifest is static, so per-preset and dark colors are not reflected.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("RootLayout");
  return {
    name: t("title"),
    description: t("description"),
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192" },
      { src: "/icons/icon-512.png", sizes: "512x512" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
