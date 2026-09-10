import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh-CN.json";

import { locales, type Locale } from "./locales";

/**
 * Catalog values that are also written to the database as data (topic
 * sentinel titles, seeded assistant names), keyed by locale. Reading the
 * real catalogs keeps them in sync by construction — no duplicated strings.
 * No hooks, so the module is importable from both server and client code.
 */
type LocalizedDefaults = {
  /** `Chat.newTopic` — placeholder title of a freshly created topic. */
  topicTitle: string;
  /** `Assistant.defaultName` — name of the first seeded assistant. */
  assistantName: string;
};

export const DEFAULT_MESSAGES: Record<Locale, LocalizedDefaults> = {
  en: {
    topicTitle: enMessages.Chat.newTopic,
    assistantName: enMessages.Assistant.defaultName,
  },
  "zh-CN": {
    topicTitle: zhMessages.Chat.newTopic,
    assistantName: zhMessages.Assistant.defaultName,
  },
};

/**
 * Every locale's `Chat.newTopic`. A stored topic title uses the creator's
 * locale, so the "title not generated yet" sentinel must accept the whole
 * set — in SQL (`IN`), the server guard, and the client pre-check alike.
 */
export const DEFAULT_TOPIC_TITLES: readonly string[] = locales.map(
  (locale) => DEFAULT_MESSAGES[locale].topicTitle,
);

/** True while a topic still carries an untouched, generated-title sentinel. */
export function isDefaultTopicTitle(title: string): boolean {
  return DEFAULT_TOPIC_TITLES.includes(title);
}
