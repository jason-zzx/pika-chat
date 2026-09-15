import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import ThemeSync from "@/components/layout/ThemeSync";
import AppProviders from "@/components/providers/AppProviders";
import { Toaster } from "@/components/ui/toast";
import {
  parseThemeCookie,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { resolveActor } from "@/server/auth/actor";
import { getUserThemePreference } from "@/server/services/user-preferences.service";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Static `metadata` is evaluated outside the request and cannot read the
// locale cookie; request-scoped titles need generateMetadata.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RootLayout");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const themeCookie = parseThemeCookie(
    cookieStore.get(THEME_COOKIE_NAME)?.value,
  );

  // Signed-in users read their preference from the DB (single source of
  // truth); anonymous pages fall back to the cookie. No redirect here — the
  // auth pages render through this layout too.
  const actor = await resolveActor(await headers());
  const preference: ThemePreference = actor
    ? await getUserThemePreference(actor.userId)
    : { mode: themeCookie.mode, preset: themeCookie.preset };

  // The server cannot probe the OS preference; for mode=system the cookie
  // carries the client's resolved hint so the first paint is not wrong.
  const resolved =
    preference.mode === "system" ? themeCookie.resolved : preference.mode;
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "h-full antialiased",
        resolved === "dark" && "dark",
      )}
      data-theme={preference.preset === "default" ? undefined : preference.preset}
    >
      <body className="flex min-h-full flex-col">
        {/* Outside AppProviders (a client component) so every client
            component below can call useTranslations. Server-rendered with no
            props: locale/messages/now/timeZone/formats are inherited from
            src/i18n/request.ts. */}
        <NextIntlClientProvider>
          <AppProviders>
            <ThemeSync initialPreference={preference} />
            {children}
          </AppProviders>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
