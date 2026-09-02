import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  chatMessagesResponseSchema,
  type ChatMessagesResponse,
} from "@/lib/schemas/chat";

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
