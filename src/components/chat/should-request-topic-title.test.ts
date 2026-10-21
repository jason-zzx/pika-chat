import { describe, expect, it } from "vitest";

import { DEFAULT_MESSAGES, DEFAULT_TOPIC_TITLES } from "@/i18n/defaults";

import { shouldRequestTopicTitle } from "./should-request-topic-title";

const enDefaultTitle = DEFAULT_MESSAGES.en.topicTitle;

describe("shouldRequestTopicTitle", () => {
  // Firing a second request for the same topic is deduped by the chat pool
  // (titleRequested), so this predicate only decides per-send intent.
  it("requests a title when this send creates a topic", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: undefined,
        displayedTitle: enDefaultTitle,
      }),
    ).toBe(true);
  });

  it("requests a title for an untitled topic, in any locale", () => {
    for (const displayedTitle of DEFAULT_TOPIC_TITLES) {
      expect(
        shouldRequestTopicTitle({
          activeTopicId: "topic-1",
          displayedTitle,
        }),
      ).toBe(true);
    }
  });

  it("does not request a title for an already-named topic", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: "topic-1",
        displayedTitle: "Lunch ideas",
      }),
    ).toBe(false);
  });
});
