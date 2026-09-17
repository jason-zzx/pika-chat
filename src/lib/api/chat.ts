import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  chatMessagesResponseSchema,
  regenerateMessageRequestSchema,
  translateMessageRequestSchema,
  translateMessageResponseSchema,
  type ChatHistoryData,
} from "@/lib/schemas/chat";
import type { z } from "zod";

function messageUrl(topicId: string, messageId: string): string {
  return `/api/topics/${encodeURIComponent(topicId)}/messages/${encodeURIComponent(messageId)}`;
}

/**
 * Parsed through `chatMessagesResponseSchema` (the narrowed wire shape) but
 * declared as `ChatUIMessage[]`: the UI works with the wider role union, and
 * the wider type is what callers write back into the query cache. Widening
 * here, once, keeps every other message-list site free of casts.
 */
export async function listTopicMessages(
  topicId: string,
): Promise<ChatHistoryData> {
  const response = await fetch(
    `/api/topics/${encodeURIComponent(topicId)}/messages`,
  );
  return parseJson(response, (data) => chatMessagesResponseSchema.parse(data));
}

export async function stopChatStream(streamId: string): Promise<void> {
  const response = await fetch("/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamId }),
  });
  await parseEmpty(response);
}

export async function deleteTopicMessage(
  topicId: string,
  messageId: string,
): Promise<void> {
  const response = await fetch(messageUrl(topicId, messageId), {
    method: "DELETE",
  });
  await parseEmpty(response);
}

export async function selectMessageVersion(
  topicId: string,
  messageId: string,
): Promise<void> {
  const response = await fetch(`${messageUrl(topicId, messageId)}/select`, {
    method: "POST",
  });
  await parseEmpty(response);
}

export type TranslateMessageRequest = z.infer<
  typeof translateMessageRequestSchema
>;

/**
 * Translates one message version (PRD 消息翻译). The server persists the
 * result on the message row and answers cache hits without a model call.
 */
export async function translateMessage(
  input: TranslateMessageRequest,
): Promise<{ translation: string }> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) =>
    translateMessageResponseSchema.parse(data),
  );
}

export type RegenerateMessageRequest = z.infer<
  typeof regenerateMessageRequestSchema
>;

/**
 * Starts a streaming regeneration. Returns the raw response: the caller reads
 * `x-pika-stream-id` from the headers and consumes the UI message stream from
 * the body itself. Error responses are thrown as the parsed error body.
 */
export async function regenerateTopicMessage(
  topicId: string,
  messageId: string,
  input: RegenerateMessageRequest,
): Promise<Response> {
  const response = await fetch(`${messageUrl(topicId, messageId)}/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data: unknown = await response.json();
    throw data;
  }
  return response;
}
