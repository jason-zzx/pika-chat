import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ChatMapDialog from "./ChatMapDialog";

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
  groupId?: string,
): ChatUIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    metadata: groupId === undefined ? {} : { groupId },
  };
}

function renderDialog(messages: ChatUIMessage[], onSelect = vi.fn()) {
  renderWithIntl(
    <ChatMapDialog
      open
      onOpenChange={vi.fn()}
      messages={messages}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

async function rows() {
  const dialog = await screen.findByRole("dialog");
  return within(dialog).getAllByRole("listitem");
}

describe("ChatMapDialog", () => {
  it("lists every message as one row in conversation order", async () => {
    renderDialog([
      textMessage("u1", "user", "first question"),
      textMessage("a1", "assistant", "first answer", "group-1"),
      textMessage("u2", "user", "second question"),
    ]);

    const items = await rows();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("first question");
    expect(items[1]).toHaveTextContent("first answer");
    expect(items[2]).toHaveTextContent("second question");
  });

  it("selects a row with the version-group key, not the message id", async () => {
    const onSelect = renderDialog([
      textMessage("u1", "user", "question"),
      textMessage("v1", "assistant", "answer", "group-1"),
    ]);

    const items = await rows();
    fireEvent.click(within(items[1]!).getByRole("button"));

    expect(onSelect).toHaveBeenCalledWith("group-1");

    fireEvent.click(within(items[0]!).getByRole("button"));
    expect(onSelect).toHaveBeenLastCalledWith("u1");
  });

  it("tells user and assistant rows apart", async () => {
    renderDialog([
      textMessage("u1", "user", "mine"),
      textMessage("a1", "assistant", "theirs", "group-1"),
    ]);

    const items = await rows();
    const mine = within(items[0]!).getByText("mine");
    expect(mine).toHaveClass("bg-muted", "font-medium");
    const theirs = within(items[1]!).getByText("theirs");
    expect(theirs).toHaveClass("border", "border-border");
    expect(theirs).not.toHaveClass("bg-muted");
  });

  it("collapses whitespace into a single preview line", async () => {
    renderDialog([
      textMessage("a1", "assistant", "line one\n\n  line two  ", "group-1"),
    ]);

    const items = await rows();
    expect(items[0]).toHaveTextContent("line one line two");
  });

  it("falls back to a placeholder for a message with no text", async () => {
    const empty: ChatUIMessage = {
      id: "regen-placeholder",
      role: "assistant",
      parts: [],
      metadata: { groupId: "group-1" },
    };
    renderDialog([empty]);

    const items = await rows();
    expect(items[0]).toHaveTextContent("No text");
  });
});
