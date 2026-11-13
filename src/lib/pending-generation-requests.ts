/**
 * Unconfirmed generation request ids, one bucket per account (chat task §4/G2).
 *
 * Only the id is stored — never prompts or message content. It exists so a
 * request whose confirmation was lost can be resolved by `?requestId=` instead
 * of being re-sent (which would call the model twice). The bucket is dropped on
 * sign-out, so account B can never inherit account A's pending ids.
 */
const STORAGE_KEY = "pika.pendingGenerationRequests";

type PendingEntry = {
  requestId: string;
  userId: string;
};

function readAll(): PendingEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: PendingEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage disabled/full: the feature degrades to "no receipt", which the
    // server still handles by request-id lookup.
  }
}

export function rememberPendingGenerationRequest(input: {
  requestId: string;
  userId: string;
}): void {
  // Keep every other account's bucket: remembering this action must not drop
  // another account's still-unresolved ids (they are looked up after a reload).
  const entries = readAll().filter(
    (entry) =>
      !(
        entry.userId === input.userId && entry.requestId === input.requestId
      ),
  );
  entries.push(input);
  writeAll(entries);
}

export function forgetPendingGenerationRequest(
  userId: string,
  requestId: string,
): void {
  writeAll(
    readAll().filter(
      (entry) => entry.userId !== userId || entry.requestId !== requestId,
    ),
  );
}

export function listPendingGenerationRequests(
  userId: string,
): PendingEntry[] {
  return readAll().filter((entry) => entry.userId === userId);
}

/** Drops every bucket: used by sign-out, which must not leak across accounts. */
export function clearPendingGenerationRequests(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
