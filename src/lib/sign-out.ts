"use client";

import { deleteTopicBestEffort } from "@/lib/api/topic";
import { authClient } from "@/lib/auth-client";
import { clearNavState } from "@/lib/navigation-state";
import { clearPendingGenerationRequests } from "@/lib/pending-generation-requests";
import { useTemporaryTopicStore } from "@/stores/temporary-topic-store";

/**
 * Sign-out boundary (chat task §7 / R2).
 *
 * After the session is really gone, the whole document is replaced so every
 * piece of the previous account's client state dies with it: the TanStack
 * query cache, the chat pool (and any live subscription), pending upload
 * callbacks and in-memory messages.
 *
 * Failures are rethrown: a sign-out that did not happen must never look like
 * one (and must not navigate away from a still-authenticated session).
 */
export async function signOutAndReset(): Promise<void> {
  const temporaryTopicId = useTemporaryTopicStore.getState().temporaryTopicId;
  if (temporaryTopicId) {
    // Delete while the session cookie is still valid; pagehide after sign-out
    // would get 401.
    await deleteTopicBestEffort(temporaryTopicId);
  }
  const result = await authClient.signOut();
  // Better Auth resolves HTTP failures as { error }, rather than rejecting.
  // Only a confirmed logout may destroy this document and its pending state.
  if (result.error) {
    throw new Error(result.error.message ?? "Sign out failed");
  }
  if (temporaryTopicId) {
    useTemporaryTopicStore.getState().consumeTemporaryTopic(temporaryTopicId);
    window.pikaNative?.setTemporaryTopic?.(null);
  }
  clearPendingGenerationRequests();
  clearNavState();
  window.location.replace("/sign-in");
}
