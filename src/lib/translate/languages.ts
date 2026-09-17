/**
 * Fixed target-language list for message translation (PRD R3). Shared between
 * the client (menu labels, translation block tags) and the server (prompt
 * wording, request validation), so it lives in the neutral `lib/` directory.
 * Menu items render `nativeName` directly — no i18n catalog entries.
 *
 * The codes tuple is the single source of truth: the union type, the
 * `{ code, nativeName }` list below, and the `z.enum` tuple all derive from
 * it, so they cannot drift.
 */
export const TRANSLATE_TARGET_LANGUAGE_CODES = [
  "zh-CN",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
] as const;

export type TranslateTargetLanguageCode =
  (typeof TRANSLATE_TARGET_LANGUAGE_CODES)[number];

/** Native self-labels, intentionally never translated. */
const TRANSLATE_TARGET_LANGUAGE_NAMES: Record<
  TranslateTargetLanguageCode,
  string
> = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
};

export const TRANSLATE_TARGET_LANGUAGES = TRANSLATE_TARGET_LANGUAGE_CODES.map(
  (code) => ({ code, nativeName: TRANSLATE_TARGET_LANGUAGE_NAMES[code] }),
);


/** Native display name for a target-language code; unknown codes render as-is. */
export function translateLanguageNativeName(code: string): string {
  return (
    TRANSLATE_TARGET_LANGUAGES.find((language) => language.code === code)
      ?.nativeName ?? code
  );
}
