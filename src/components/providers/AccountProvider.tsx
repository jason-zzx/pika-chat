"use client";

import { useEffect, type ReactNode } from "react";

import { resetChatPool } from "@/components/chat/chat-pool";
import { AccountUserIdContext } from "@/hooks/use-account-user";
import { authClient } from "@/lib/auth-client";
import { clearPendingGenerationRequests } from "@/lib/pending-generation-requests";
import { resetStreamingTopics } from "@/lib/streaming-topics";

/**
 * Account identity boundary for the whole client document (chat task R2/R5/§7).
 *
 * The app is a single-page shell: the QueryClient, the chat pool (and any live
 * generation subscription) and the composer drafts all outlive route changes.
 * They must NOT outlive the account. Both explicit sign-out entries already
 * replace the document (see `src/lib/sign-out.ts`); this covers the other two
 * ways an identity can change under a running document:
 *
 * - the session is confirmed gone (signed out or revoked in another tab) →
 *   replace with the sign-in page;
 * - the session now belongs to a DIFFERENT account (signed in as B in another
 *   tab) → reload the current URL under the new identity.
 *
 * Both destroy the old document, which is what drops the previous account's
 * query cache, pooled chats, pending uploads and receipt ids.
 *
 * Deliberately conservative: a pending or failed session check (offline, auth
 * backend error) is NOT proof of an account change, so `loading`/network
 * failures never clear the page. Better Auth's session store already refreshes
 * on focus/visibility, on reconnect, and across tabs over its broadcast
 * channel, so this needs no polling of its own.
 */
export default function AccountProvider({
  userId,
  children,
}: {
  /** The account the server rendered this document for; null = anonymous. */
  userId: string | null;
  children: ReactNode;
}) {
  useAccountIdentityGuard(userId);
  return (
    <AccountUserIdContext.Provider value={userId}>
      {children}
    </AccountUserIdContext.Provider>
  );
}

function useAccountIdentityGuard(baselineUserId: string | null) {
  const session = authClient.useSession();
  const observedUserId = session.data?.user?.id ?? null;
  const unauthorized = session.error?.status === 401;
  // A *confirmed* absence: the request settled with no session, either
  // normally (`error` null) or because the server said 401. A network failure
  // keeps the last known data and is ignored here.
  const confirmedSignedOut =
    observedUserId === null &&
    !session.isPending &&
    (session.error === null || session.error === undefined || unauthorized);
  const changedAccount =
    observedUserId !== null && observedUserId !== baselineUserId;

  useEffect(() => {
    if (baselineUserId === null) {
      // Nothing account-owned was rendered into this document.
      return;
    }
    if (changedAccount) {
      discardAccountOwnedState();
      // Keep the URL: the new account's view of the same route.
      window.location.reload();
      return;
    }
    if (confirmedSignedOut) {
      discardAccountOwnedState();
      window.location.replace("/sign-in");
    }
  }, [baselineUserId, changedAccount, confirmedSignedOut]);
}

/** Drop what this document holds for the previous account. */
function discardAccountOwnedState(): void {
  clearPendingGenerationRequests();
  resetChatPool();
  resetStreamingTopics();
}
