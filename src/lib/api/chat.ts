import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  chatMessagesResponseSchema,
  regenerateMessageRequestSchema,
  type ChatMessagesResponse,
} from "@/lib/schemas/chat";
import type { z } from "zod";

function messageUrl(topicId: string, messageId: string): string {
  return `/api/topics/${encodeURIComponent(topicId)}/messages/${encodeURIComponent(messageId)}`;
}

export async function listTopicMessages(
  topicId: string,
): Promise<ChatMessagesResponse> {
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
