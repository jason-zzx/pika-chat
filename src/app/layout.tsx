import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import ThemeSync from "@/components/layout/ThemeSync";
import AppProviders from "@/components/providers/AppProviders";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import { cn } from "@/lib/utils";
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
  const theme = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "h-full antialiased",
        theme.resolved === "dark" && "dark",
      )}
    >
      <body className="flex min-h-full flex-col">
        {/* Outside AppProviders (a client component) so every client
            component below can call useTranslations. Server-rendered with no
            props: locale/messages/now/timeZone/formats are inherited from
            src/i18n/request.ts. */}
        <NextIntlClientProvider>
          <AppProviders>
            <ThemeSync initialMode={theme.mode} />
            {children}
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
