import type { ChatUIMessage } from "@/lib/schemas/chat";

const RETRY_DELAY_MS = 400;

export type ResolveServerMessageIdOptions = {
  message: ChatUIMessage;
  /** Fetches the latest persisted history (never a cached one). */
  fetchHistory: () => Promise<ChatUIMessage[]>;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Ensures the id an assistant-message action (regenerate/delete/select) is
 * about to send is already known to the server (B6).
 *
 * User message ids are chosen client-side and persisted as-is before the
 * stream starts, so they never need this check. Assistant message ids come
 * from the server stream itself, and persistence normally finishes before
 * the stream closes (the response only ends after the onEnd persistence
 * flush) — but a stop/abort can release the client first, so an absent id
 * is retried once before giving up. Genuinely unknown ids still fail
 * server-side; this guard only absorbs the persistence race and returns
 * null so the caller can surface a retryable error instead of a 404.
 */
export async function resolveServerMessageId({
  message,
  fetchHistory,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ResolveServerMessageIdOptions): Promise<string | null> {
  if (message.role !== "assistant") {
    return message.id;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const history = await fetchHistory();
    if (history.some((entry) => entry.id === message.id)) {
      return message.id;
    }
    if (attempt === 0) {
      // The server may still be persisting the streamed message (onEnd).
      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}
