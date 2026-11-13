"use client";

import { authClient } from "@/lib/auth-client";
import { clearPendingGenerationRequests } from "@/lib/pending-generation-requests";

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
  const result = await authClient.signOut();
  // Better Auth resolves HTTP failures as { error }, rather than rejecting.
  // Only a confirmed logout may destroy this document and its pending state.
  if (result.error) {
    throw new Error(result.error.message ?? "Sign out failed");
  }
  clearPendingGenerationRequests();
  window.location.replace("/sign-in");
}
