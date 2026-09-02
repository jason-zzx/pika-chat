import { describe, expect, it } from "vitest";

import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";

import { shouldRequestTopicTitle } from "./should-request-topic-title";

describe("shouldRequestTopicTitle", () => {
  it("requests a title when this send creates a topic", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: undefined,
        displayedTitle: DEFAULT_TOPIC_TITLE,
        requestedTopicIds: new Set(),
      }),
    ).toBe(true);
  });

  it("requests a title for an existing untitled topic once", () => {
    expect(
      shouldRequestTopicTitle({
        activeTopicId: "topic-1",
        displayedTitle: DEFAULT_TOPIC_TITLE,
        requestedTopicIds: new Set(),
      }),
    ).toBe(true);
    expect(
      shouldRequestTopicTitle({
        activeTopicId: "topic-1",
        displayedTitle: DEFAULT_TOPIC_TITLE,
        requestedTopicIds: new Set(["topic-1"]),
      }),
    ).toBe(false);
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
