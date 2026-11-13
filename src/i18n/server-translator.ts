import "server-only";

import { createTranslator } from "next-intl";

import type { ErrorsTranslator } from "@/lib/api/error-contract";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

/**
 * Locale-explicit translator for code that runs outside a request.
 *
 * `getTranslations()` resolves messages through `i18n/request.ts`, which reads
 * cookies and headers — unavailable in a background generation. The entry
 * captures the request locale at admission; this rebuilds the same `Errors`
 * catalog from the static import map instead.
 */
const CATALOGS: Record<Locale, () => Promise<{ default: object }>> = {
  en: () => import("../../messages/en.json"),
  "zh-CN": () => import("../../messages/zh-CN.json"),
};

export async function errorsTranslatorFor(
  locale: string | undefined,
): Promise<ErrorsTranslator> {
  const resolved: Locale =
    locale !== undefined && isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = (await CATALOGS[resolved]()).default;
  return createTranslator({
    locale: resolved,
    messages: messages as never,
    namespace: "Errors",
  } as never) as unknown as ErrorsTranslator;
}
