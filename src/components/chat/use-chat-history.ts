"use client";

import { useQuery } from "@tanstack/react-query";

import { listTopicMessages } from "@/lib/api/chat";

export const chatKeys = {
  all: ["chat"] as const,
  history: (topicId: string) => [...chatKeys.all, "history", topicId] as const,
};

export function useChatHistory(topicId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.history(topicId ?? "none"),
    queryFn: () => listTopicMessages(topicId ?? ""),
    enabled: Boolean(topicId),
  });
}
