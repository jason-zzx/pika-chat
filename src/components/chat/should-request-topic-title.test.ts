import { describe, expect, it } from "vitest";

import { DEFAULT_MESSAGES, DEFAULT_TOPIC_TITLES } from "@/i18n/defaults";

import { shouldRequestTopicTitle } from "./should-request-topic-title";

const enDefaultTitle = DEFAULT_MESSAGES.en.topicTitle;

describe("shouldRequestTopicTitle", () => {
  it("requests a title when this send creates a topic", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: undefined,
        displayedTitle: enDefaultTitle,
        requestedTopicIds: new Set(),
      }),
    ).toBe(true);
  });

  it("requests a title for an untitled topic once, in any locale", () => {
    for (const displayedTitle of DEFAULT_TOPIC_TITLES) {
      expect(
        shouldRequestTopicTitle({
          activeTopicId: "topic-1",
          displayedTitle,
          requestedTopicIds: new Set(),
        }),
      ).toBe(true);
      expect(
        shouldRequestTopicTitle({
          activeTopicId: "topic-1",
          displayedTitle,
          requestedTopicIds: new Set(["topic-1"]),
        }),
      ).toBe(false);
    }
  });

  it("does not request a title for an already-named topic", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: "topic-1",
        displayedTitle: "Lunch ideas",
        requestedTopicIds: new Set(),
      }),
    ).toBe(false);
  });
});
