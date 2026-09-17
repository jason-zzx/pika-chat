"use client";

import { useQuery } from "@tanstack/react-query";

import { listTopicMessages } from "@/lib/api/chat";
import { getTopic } from "@/lib/api/topic";

export const chatKeys = {
  all: ["chat"] as const,
  history: (topicId: string) => [...chatKeys.all, "history", topicId] as const,
};

export const topicKeys = {
  all: ["topic"] as const,
  detail: (topicId: string | undefined) =>
    [...topicKeys.all, "detail", topicId] as const,
};

export function useChatHistory(topicId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.history(topicId ?? "none"),
    queryFn: () => listTopicMessages(topicId ?? ""),
    enabled: Boolean(topicId),
  });
}

/** Topic detail — currently only the compression boundary, which drives the
 * "earlier conversation compressed" marker in the message list. */
export function useTopicDetail(topicId: string | undefined) {
  return useQuery({
    queryKey: topicKeys.detail(topicId),
    queryFn: () => getTopic(topicId ?? ""),
    enabled: Boolean(topicId),
  });
}
