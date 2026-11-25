"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { discardChat } from "@/components/chat/chat-pool";
import { chatKeys, topicKeys } from "@/components/chat/use-chat-history";
import { useAccountUserId } from "@/hooks/use-account-user";
import { generationKeys } from "@/lib/api/generation";
import { deleteTopicBestEffort } from "@/lib/api/topic";
import { useComposerStore } from "@/stores/composer-store";
import { useTemporaryTopicStore } from "@/stores/temporary-topic-store";

/**
 * Deletes the active temporary chat when the user leaves its route, triggers a
 * same-route reset (New topic / home logo / header toggle), or unloads the
 * page, clears client caches/pool state, and mirrors the active id to
 * `window.pikaNative`.
 */
export default function TemporaryTopicGuard() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const userId = useAccountUserId();
  const temporaryTopicId = useTemporaryTopicStore(
    (state) => state.temporaryTopicId,
  );
  const leaveRequestCount = useTemporaryTopicStore(
    (state) => state.leaveRequestCount,
  );

  const prevPathnameRef = useRef(pathname);
  const prevLeaveCountRef = useRef(leaveRequestCount);

  useEffect(() => {
    window.pikaNative?.setTemporaryTopic?.(temporaryTopicId);
  }, [temporaryTopicId]);

  useEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== pathname;
    const leaveRequested = prevLeaveCountRef.current !== leaveRequestCount;
    prevPathnameRef.current = pathname;
    prevLeaveCountRef.current = leaveRequestCount;
    if (!temporaryTopicId || (!pathnameChanged && !leaveRequested)) {
      return;
    }
    if (!useTemporaryTopicStore.getState().consumeTemporaryTopic(temporaryTopicId)) {
      return;
    }
    void deleteTopicBestEffort(temporaryTopicId);
    discardChat(temporaryTopicId);
    useComposerStore.getState().clearTemporaryDrafts();
    queryClient.removeQueries({
      queryKey: chatKeys.history(userId, temporaryTopicId),
    });
    queryClient.removeQueries({
      queryKey: topicKeys.detail(userId, temporaryTopicId),
    });
    void queryClient.invalidateQueries({
      queryKey: generationKeys.active(userId),
    });
  }, [pathname, leaveRequestCount, temporaryTopicId, queryClient, userId]);

  useEffect(() => {
    const handlePageHide = () => {
      const id = useTemporaryTopicStore.getState().temporaryTopicId;
      if (!id) {
        return;
      }
      useTemporaryTopicStore.getState().consumeTemporaryTopic(id);
      void deleteTopicBestEffort(id, { keepalive: true });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return null;
}
