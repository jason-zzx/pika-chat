import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE_NAME,
  matchAcceptLanguage,
  type Locale,
} from "./locales";

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }
  return (
    matchAcceptLanguage((await headers()).get("accept-language")) ??
    DEFAULT_LOCALE
  );
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    // Template-literal import is the official example's pattern; both
    // catalogs are statically analyzable (parent design §10 fallback: an
    // explicit locale→import map if standalone tracing ever misses one).
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
