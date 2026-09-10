export const locales = ["en", "zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** Mirrors THEME_COOKIE_MAX_AGE — one year, path=/, SameSite=Lax. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Native self-labels; intentionally not translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const localeSet: ReadonlySet<string> = new Set(locales);

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && localeSet.has(value);
}

/**
 * Minimal Accept-Language negotiation: the highest-q supported tag wins.
 * Exact match first (`zh-CN`), then prefix match (`zh`, `zh-Hans`) so a base
 * language tag maps onto the regional catalog. Returns `undefined` when the
 * header offers nothing we serve (caller falls back to `DEFAULT_LOCALE`).
 */
export function matchAcceptLanguage(header: string | null): Locale | undefined {
  if (header === null || header.trim() === "") {
    return undefined;
  }

  const entries = header
    .split(",")
    .map((part, order) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      // Trim before slicing: `; q=0.8` (whitespace after the separator) is a
      // valid header, and the leading space must not shift the `q=` offset.
      const parsed = qParam === undefined ? 1 : Number(qParam.trim().slice(2));
      const q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      return { tag: tag.trim().toLowerCase(), q, order };
    })
    .filter((entry) => entry.tag !== "")
    // Stable q-descending order; ties keep header order.
    .sort((a, b) => (b.q - a.q) || (a.order - b.order));

  for (const { tag, q } of entries) {
    if (q === 0) {
      continue;
    }
    const exact = locales.find((locale) => locale.toLowerCase() === tag);
    if (exact !== undefined) {
      return exact;
    }
    const [prefix = ""] = tag.split("-");
    const byPrefix = locales.find(
      (locale) => locale.toLowerCase().split("-")[0] === prefix,
    );
    if (byPrefix !== undefined) {
      return byPrefix;
    }
  }
  return undefined;
}
