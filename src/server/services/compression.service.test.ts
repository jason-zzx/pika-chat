import { describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import {
  FILE_PART_TOKEN_ALLOWANCE,
  SUMMARY_INSTRUCTIONS,
  boundaryFromSummaryState,
  estimateMessagesTokens,
  exceedsCompressionThreshold,
  messagesAfterBoundary,
  transcriptForSummary,
} from "@/server/services/compression.service";

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): ChatUIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("estimateMessagesTokens", () => {
  it("estimates text at a conservative 2 chars per token", () => {
    expect(estimateMessagesTokens([textMessage("m1", "user", "a".repeat(10))]))
      .toBe(5);
  });

  it("counts reasoning text like regular text", () => {
    const message: ChatUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "a".repeat(8) }],
    };
    expect(estimateMessagesTokens([message])).toBe(4);
  });

  it("charges a fixed allowance per file part", () => {
    const message: ChatUIMessage = {
      id: "m1",
      role: "user",
      parts: [
        {
          type: "file",
          url: "/api/files/f1",
          mediaType: "application/pdf",
          filename: "doc.pdf",
        },
      ],
    };
    expect(estimateMessagesTokens([message])).toBe(FILE_PART_TOKEN_ALLOWANCE);
  });

  it("estimates tool parts from their serialized size", () => {
    const part = {
      type: "tool-searchWeb",
      toolCallId: "t1",
      state: "output-available",
      input: { query: "q" },
      output: { results: [] },
    } as unknown as ChatUIMessage["parts"][number];
    const message: ChatUIMessage = { id: "m1", role: "assistant", parts: [part] };
    expect(estimateMessagesTokens([message])).toBe(
      Math.ceil(JSON.stringify(part).length / 2),
    );
  });
});

describe("exceedsCompressionThreshold", () => {
  it("fires above 80% of the context window and not below", () => {
    // 100 chars ≈ 50 estimated tokens; an 80-token window trips at >64.
    const messages = [textMessage("m1", "user", "a".repeat(100))];
    expect(exceedsCompressionThreshold(messages, 80)).toBe(false);
    expect(exceedsCompressionThreshold(messages, 60)).toBe(true);
  });
});

describe("messagesAfterBoundary", () => {
  const messages = [
    textMessage("m1", "user", "one"),
    textMessage("m2", "assistant", "two"),
    textMessage("m3", "user", "three"),
  ];

  it("returns the full history without a boundary", () => {
    expect(messagesAfterBoundary(messages, null)).toBe(messages);
  });

  it("returns only the messages after the boundary (boundary inclusive)", () => {
    expect(messagesAfterBoundary(messages, { id: "m2", groupId: null })).toEqual(
      [messages[2]],
    );
  });

  it("returns nothing when the boundary is the last message", () => {
    expect(messagesAfterBoundary(messages, { id: "m3", groupId: null })).toEqual(
      [],
    );
  });

  it("falls back to the full history when the boundary id is gone", () => {
    expect(
      messagesAfterBoundary(messages, { id: "deleted", groupId: null }),
    ).toBe(messages);
  });

  it("matches by version group so a boundary-group version switch keeps the clip", () => {
    const grouped: ChatUIMessage[] = [
      textMessage("m1", "user", "one"),
      {
        ...textMessage("m2b", "assistant", "two"),
        metadata: { groupId: "m2" },
      },
      textMessage("m3", "user", "three"),
    ];
    // The boundary persisted row m2, but that group now has m2b selected.
    expect(
      messagesAfterBoundary(grouped, { id: "m2", groupId: "m2" }),
    ).toEqual([grouped[2]]);
  });
});

describe("boundaryFromSummaryState", () => {
  it("maps the persisted summary state onto the boundary shape", () => {
    expect(
      boundaryFromSummaryState({
        summaryUpToMessageId: "m4",
        summaryUpToGroupId: "g4",
      }),
    ).toEqual({ id: "m4", groupId: "g4" });
  });

  it("returns null without a boundary id or state", () => {
    expect(boundaryFromSummaryState(null)).toBeNull();
    expect(
      boundaryFromSummaryState({
        summaryUpToMessageId: null,
        summaryUpToGroupId: null,
      }),
    ).toBeNull();
  });
});

describe("transcriptForSummary", () => {
  it("labels roles and marks attachments by filename without payload", () => {
    const transcript = transcriptForSummary([
      {
        id: "m1",
        role: "user",
        parts: [
          {
            type: "file",
            url: "/api/files/f1",
            mediaType: "image/png",
            filename: "shot.png",
          },
          { type: "text", text: "what is this?" },
        ],
      },
      textMessage("m2", "assistant", "a screenshot"),
    ]);
    expect(transcript).toBe(
      "User: [Attachment: shot.png]\nwhat is this?\n\nAssistant: a screenshot",
    );
  });

  it("skips messages with no textual content", () => {
    const reasoningOnly: ChatUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "hmm" }],
    };
    expect(transcriptForSummary([reasoningOnly])).toBe("");
  });
});

describe("SUMMARY_INSTRUCTIONS", () => {
  it("asks for a merged rolling summary in the conversation language", () => {
    expect(SUMMARY_INSTRUCTIONS).toContain("previous summary");
    expect(SUMMARY_INSTRUCTIONS).toContain("conversation's language");
  });
});
