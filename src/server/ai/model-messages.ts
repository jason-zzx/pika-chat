import "server-only";

import { convertToModelMessages, type ModelMessage } from "ai";

import type { ChatUIMessage } from "@/lib/schemas/chat";

/**
 * Replays persisted UI messages into model messages for a new turn.
 *
 * `ignoreIncompleteToolCalls` is load-bearing: a stream interrupted after the
 * model emitted a tool call but before its output persists an
 * input-available/input-streaming tool part. Replayed as-is, that becomes an
 * assistant tool-call with no matching tool result, and strict vendors then
 * reject every subsequent turn with a 400. Dropping the incomplete call keeps
 * follow-up turns usable; completed tool calls still replay normally.
 *
 * A `data-quote` part becomes a text part holding the quoted excerpt, so the
 * model reads the quote as context while the user's own text stays as typed.
 */
export function replayModelMessages(
  messages: ChatUIMessage[],
): Promise<ModelMessage[]> {
  return convertToModelMessages<ChatUIMessage>(messages, {
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) =>
      part.type === "data-quote"
        ? { type: "text", text: `<quote>\n${part.data.text}\n</quote>` }
        : undefined,
  });
}
