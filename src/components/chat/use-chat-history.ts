"use client";

import { useQuery } from "@tanstack/react-query";

import { listTopicMessages } from "@/lib/api/chat";
import { getTopic } from "@/lib/api/topic";

/**
 * Keys are scoped by account first (chat task R5/§7): the QueryClient lives for
 * the whole document, and a cookie change in another tab makes this document
 * act as a different account before the identity boundary reloads it. An
 * unscoped key would let the previous account's cached conversation be read
 * (and seeded into the chat) in that window. `null` = anonymous/tests.
 */
export const chatKeys = {
  all: ["chat"] as const,
  history: (userId: string | null, topicId: string) =>
    [...chatKeys.all, userId ?? "anonymous", "history", topicId] as const,
};

export const topicKeys = {
  all: ["topic"] as const,
  detail: (userId: string | null, topicId: string | undefined) =>
    [...topicKeys.all, userId ?? "anonymous", "detail", topicId] as const,
};

export function useChatHistory(
  userId: string | null,
  topicId: string | undefined,
) {
  return useQuery({
    queryKey: chatKeys.history(userId, topicId ?? "none"),
    queryFn: () => listTopicMessages(topicId ?? ""),
    enabled: Boolean(topicId),
  });
}

/** Topic detail — currently only the compression boundary, which drives the
 * "earlier conversation compressed" marker in the message list. */
export function useTopicDetail(
  userId: string | null,
  topicId: string | undefined,
) {
  return useQuery({
    queryKey: topicKeys.detail(userId, topicId),
    queryFn: () => getTopic(topicId ?? ""),
    enabled: Boolean(topicId),
  });
}
