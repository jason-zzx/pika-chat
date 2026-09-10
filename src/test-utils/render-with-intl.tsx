import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh-CN.json";

const MESSAGES: Record<Locale, AbstractIntlMessages> = {
  en: enMessages,
  "zh-CN": zhMessages,
};

type RenderWithIntlOptions = {
  locale?: Locale;
  /** Fixed clock so date/age output stays deterministic. */
  now?: Date;
  timeZone?: string;
};

/**
 * Wraps a tree in `NextIntlClientProvider` with the real catalogs, for tests
 * that rerender manually. Prefer `renderWithIntl` for the initial render.
 */
export function wrapWithIntl(
  ui: ReactNode,
  options: RenderWithIntlOptions = {},
): ReactNode {
  const { locale = DEFAULT_LOCALE, now, timeZone = "UTC" } = options;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      now={now}
      timeZone={timeZone}
    >
      {ui}
    </NextIntlClientProvider>
  );
}

/**
 * Renders through `next-intl`. Required by every `.tsx` test whose tree calls
 * `useTranslations` — without the provider next-intl throws "context from
 * NextIntlClientProvider was not found". See `.trellis/spec/frontend/i18n.md`.
 */
export function renderWithIntl(
  ui: ReactNode,
  options: RenderWithIntlOptions = {},
): RenderResult {
  return render(wrapWithIntl(ui, options));
}
