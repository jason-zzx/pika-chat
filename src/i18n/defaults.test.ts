import { describe, expect, it } from "vitest";

import {
  DEFAULT_MESSAGES,
  DEFAULT_TOPIC_TITLES,
  isDefaultTopicTitle,
} from "./defaults";
import { locales } from "./locales";

describe("DEFAULT_TOPIC_TITLES", () => {
  it("covers every supported locale exactly once", () => {
    expect(DEFAULT_TOPIC_TITLES).toHaveLength(locales.length);
    expect(new Set(DEFAULT_TOPIC_TITLES).size).toBe(locales.length);
  });
});

describe("isDefaultTopicTitle", () => {
  it("recognizes every locale's default title", () => {
    for (const title of DEFAULT_TOPIC_TITLES) {
      expect(isDefaultTopicTitle(title)).toBe(true);
    }
  });

  it("rejects a renamed or generated title", () => {
    expect(isDefaultTopicTitle("Lunch ideas")).toBe(false);
    expect(isDefaultTopicTitle("")).toBe(false);
  });
});

describe("DEFAULT_MESSAGES", () => {
  it("exposes a default assistant name for every locale", () => {
    for (const locale of locales) {
      expect(DEFAULT_MESSAGES[locale].assistantName.length).toBeGreaterThan(0);
    }
  });
});
