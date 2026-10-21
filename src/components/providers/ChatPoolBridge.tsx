"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  assistantKeys,
  useGenerateTopicTitle,
} from "@/components/assistant/use-assistants";
import { configureChatPool } from "@/components/chat/chat-pool";
import {
  chatKeys,
  topicKeys,
} from "@/components/chat/use-chat-history";
import { listTopicMessages } from "@/lib/api/chat";

/**
 * Wires the chat pool's module-level side effects to app services. The pool
 * itself is hook-free so its handlers keep working after every ChatView has
 * unmounted (a stream finishing while the user sits on a settings page
 * still invalidates the tree/history caches and fires the title request).
 */
export default function ChatPoolBridge() {
  const queryClient = useQueryClient();
  // useMutation's `mutate` is stable (useCallback over a stable observer),
  // so the bridge registers once and always fires the live mutation.
  const { mutate: generateTitleMutate } = useGenerateTopicTitle();

  useEffect(() => {
    return configureChatPool({
      invalidateTree: () => {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
      },
      invalidateAfterFinish: (topicId) => {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
        if (!topicId) {
          return;
        }
        void queryClient.invalidateQueries({
          queryKey: chatKeys.history(topicId),
        });
        // The send may have auto-compressed the history server-side; refresh
        // the detail so the marker reflects the new boundary.
        void queryClient.invalidateQueries({
          queryKey: topicKeys.detail(topicId),
        });
        // A stream that finished in the background (user on another page)
        // leaves the history query INACTIVE: invalidation only marks it
        // stale, so the next visit would seed the stale cache and the seed
        // guard would then block the mount refetch — the finished turn
        // would vanish until the visit after. Fetch eagerly so the cache
        // holds the persisted turn before anyone revisits.
        const query = queryClient
          .getQueryCache()
          .find({ queryKey: chatKeys.history(topicId), exact: true });
        if (query && !query.isActive()) {
          void queryClient.fetchQuery({
            queryKey: chatKeys.history(topicId),
            queryFn: () => listTopicMessages(topicId),
          });
        }
      },
      requestTitle: (topicId, pick) => {
        generateTitleMutate({
          id: topicId,
          input: {
            providerConfigId: pick.configId,
            modelId: pick.modelId,
          },
        });
      },
    });
  }, [queryClient, generateTitleMutate]);

  return null;
}
