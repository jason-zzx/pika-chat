import { describe, expect, it } from "vitest";

import { parseAssistantPath } from "./assistant-path";

describe("parseAssistantPath", () => {
  it("reads assistant and topic ids", () => {
    expect(parseAssistantPath("/assistant/a1/t1")).toEqual({
      assistantId: "a1",
      topicId: "t1",
    });
    expect(parseAssistantPath("/assistant/a1")).toEqual({
      assistantId: "a1",
      topicId: undefined,
    });
    expect(parseAssistantPath("/")).toEqual({
      assistantId: undefined,
      topicId: undefined,
    });
  });
});
