"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { assistantKeys } from "@/components/assistant/use-assistants";
import { configureChatPool } from "@/components/chat/chat-pool";
import {
  chatKeys,
  topicKeys,
} from "@/components/chat/use-chat-history";
import { useAccountUserId } from "@/hooks/use-account-user";
import { useActiveGenerations } from "@/hooks/use-active-generations";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { listTopicMessages } from "@/lib/api/chat";
import {
  findGenerationByRequest,
  generationKeys,
} from "@/lib/api/generation";
import { apiErrorCode } from "@/lib/api/error-message";
import {
  forgetPendingGenerationRequest,
  listPendingGenerationRequests,
} from "@/lib/pending-generation-requests";
import {
  localStreamingTopics,
  syncServerStreamingTopics,
} from "@/lib/streaming-topics";

/**
 * Wires the chat pool's module-level side effects to app services. The pool
 * itself is hook-free so its handlers keep working after every ChatView has
 * unmounted (a stream finishing while the user sits on a settings page still
 * invalidates the tree/history caches). Title generation no longer travels
 * through the browser: the server names the topic when the turn completes.
 *
 * Everything account-owned here is keyed by the signed-in user id: the
 * QueryClient and the pool live for the whole document, so an unscoped key
 * would leak one account's task ids into a document that changed accounts.
 */
export default function ChatPoolBridge() {
  const queryClient = useQueryClient();
  const userId = useAccountUserId();
  // Server-owned turns are the source of truth for the sidebar spinner: this
  // runs app-wide (not per topic), so a turn started in another tab or before
  // a refresh still shows while it runs.
  const activeGenerations = useActiveGenerations(userId);

  useEffect(() => {
    const topicIds = (activeGenerations.data?.generations ?? [])
      .map((generation) => generation.topicId)
      .filter((topicId): topicId is string => Boolean(topicId));
    syncServerStreamingTopics(topicIds, localStreamingTopics());
  }, [activeGenerations.data]);

  /**
   * The turn is over server-side: refresh what the finished reply changed.
   * The history query is fetched eagerly when inactive — invalidation alone
   * only marks it stale, and the next visit's seed would then show the
   * pre-turn cache while the seed guard blocked the mount refetch.
   */
  const refreshAfterGeneration = useStableCallback((topicId: string | null) => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
    void queryClient.invalidateQueries({
      queryKey: generationKeys.active(userId),
    });
    if (!topicId) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: chatKeys.history(userId, topicId),
    });
    // The send may have auto-compressed the history server-side; refresh
    // the detail so the marker reflects the new boundary.
    void queryClient.invalidateQueries({
      queryKey: topicKeys.detail(userId, topicId),
    });
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: chatKeys.history(userId, topicId), exact: true });
    if (query && !query.isActive()) {
      void queryClient.fetchQuery({
        queryKey: chatKeys.history(userId, topicId),
        queryFn: () => listTopicMessages(topicId),
      });
    }
  });

  useEffect(() => {
    return configureChatPool({
      invalidateTree: () => {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
      },
      invalidateAfterFinish: (topicId) => refreshAfterGeneration(topicId),
    });
  }, [queryClient, refreshAfterGeneration]);

  // Reload recovery for a request whose confirmation was lost (chat task
  // §4/G2): look each stored receipt up by request id — never re-POST, which
  // would be a second model call. A found task is adopted by the normal
  // discovery/stream path; a 404 (expired, rejected, or never admitted) simply
  // retires the id. A network failure keeps it for the next visit.
  useEffect(() => {
    if (userId === null) {
      return;
    }
    const pending = listPendingGenerationRequests(userId);
    if (pending.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const entry of pending) {
        try {
          const { generation } = await findGenerationByRequest(
            entry.requestId,
          );
          if (cancelled) {
            return;
          }
          forgetPendingGenerationRequest(userId, entry.requestId);
          void queryClient.invalidateQueries({
            queryKey: generationKeys.active(userId),
          });
          refreshAfterGeneration(generation.topicId);
        } catch (error) {
          if (cancelled) {
            return;
          }
          // The server answered (not found / conflict / deleted target): the
          // receipt will never resolve into a task, so stop asking.
          const code = apiErrorCode(error);
          if (code === "NOT_FOUND" || code === "CONFLICT") {
            forgetPendingGenerationRequest(userId, entry.requestId);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, queryClient, refreshAfterGeneration]);

  return null;
}
