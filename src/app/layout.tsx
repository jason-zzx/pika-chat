import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

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

export const metadata: Metadata = {
  title: "pika-chat",
  description: "Self-hosted AI chat",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const theme = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );

  return (
    <html
      lang="en"
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "h-full antialiased",
        theme.resolved === "dark" && "dark",
      )}
    >
      <body className="flex min-h-full flex-col">
        <AppProviders>
          <ThemeSync initialMode={theme.mode} />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
