"use server";

import { cookies } from "next/headers";

import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./locales";

/**
 * Persists the language choice. A Server Action (not a `document.cookie`
 * write) because only a server round-trip re-renders the server tree —
 * next-intl #2162; see `.trellis/spec/frontend/i18n.md`.
 */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  // Server Action input is runtime data; ignore anything off-catalog.
  if (!isLocale(locale)) {
    return;
  }
  (await cookies()).set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}
