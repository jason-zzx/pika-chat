import type { ChatUIMessage } from "@/lib/schemas/chat";

export type RegenerateTargetRef = {
  id: string;
  role: "user" | "assistant";
};

export type RegenPlaceholderPlan = {
  placeholder: ChatUIMessage;
  /** Message the placeholder replaced; null when it was inserted into an
   * empty answer slot (regenerating a user message with no answer yet). */
  replaced: ChatUIMessage | null;
  /** Id of the message the regenerate was requested on. */
  targetId: string;
  /** Version group the new answer belongs to; undefined opens a new group
   * whose id is only known once the stream announces the message id. */
  groupId: string | undefined;
};

/**
 * Builds the empty streaming placeholder that replaces the answer being
 * regenerated the moment the user clicks regenerate (R7): the thinking
 * shimmer must render immediately, not only once the first chunk arrives.
 * For a user target the placeholder takes over the following assistant
 * answer slot, or opens a fresh one right after the user message.
 */
export function buildRegenPlaceholder(
  messages: ChatUIMessage[],
  target: RegenerateTargetRef,
  targetIndex: number,
): RegenPlaceholderPlan | null {
  const targetPosition = messages.findIndex(
    (message) => message.id === target.id,
  );
  const at = targetPosition >= 0 ? targetPosition : targetIndex;
  const targetMessage = messages[at];
  if (!targetMessage || targetMessage.id !== target.id) {
    return null;
  }

  const answer =
    target.role === "assistant"
      ? targetMessage
      : messages[at + 1]?.role === "assistant"
        ? messages[at + 1]
        : undefined;
  const groupId = answer
    ? (answer.metadata?.groupId ?? answer.id)
    : undefined;
  const placeholder: ChatUIMessage = {
    id: `regen-placeholder:${target.id}`,
    role: "assistant",
    parts: [],
    metadata: groupId === undefined ? undefined : { groupId },
  };
  return { placeholder, replaced: answer ?? null, targetId: target.id, groupId };
}

/** Swaps the regenerated answer's current version for the placeholder. */
export function insertRegenPlaceholder(
  current: ChatUIMessage[],
  plan: RegenPlaceholderPlan,
): ChatUIMessage[] {
  if (plan.replaced) {
    return current.map((message) =>
      message.id === plan.replaced?.id ? plan.placeholder : message,
    );
  }
  // Fresh answer slot: insert after the target user message when it is still
  // present, otherwise append (the reseed after teardown fixes ordering).
  const targetPosition = current.findIndex(
    (message) => message.id === plan.targetId,
  );
  const at = targetPosition >= 0 ? targetPosition + 1 : current.length;
  return [
    ...current.slice(0, at),
    plan.placeholder,
    ...current.slice(at),
  ];
}

/**
 * Undoes the placeholder when the regeneration never started (request
 * failed before any chunk streamed): the replaced version comes back, an
 * inserted placeholder is removed. Server state is untouched in this path.
 */
export function removeRegenPlaceholder(
  current: ChatUIMessage[],
  plan: RegenPlaceholderPlan,
): ChatUIMessage[] {
  const replaced = plan.replaced;
  if (replaced) {
    return current.map((message) =>
      message.id === plan.placeholder.id ? replaced : message,
    );
  }
  return current.filter((message) => message.id !== plan.placeholder.id);
}

/**
 * Folds one streamed frame of a regenerated answer into the message list:
 * updates the streaming message once present, replaces the placeholder left
 * by buildRegenPlaceholder, then falls back to the captured target position.
 * Frames keep the group's `groupId` in metadata so list keys (and the
 * tap-to-reveal state keyed by them) survive the placeholder → stream →
 * reseed handoff.
 */
export function upsertRegeneratedMessage(
  current: ChatUIMessage[],
  next: ChatUIMessage,
  target: RegenerateTargetRef,
  targetIndex: number,
  plan?: RegenPlaceholderPlan,
): ChatUIMessage[] {
  const frame =
    plan?.groupId !== undefined && next.metadata?.groupId === undefined
      ? { ...next, metadata: { ...next.metadata, groupId: plan.groupId } }
      : next;
  if (current.some((message) => message.id === frame.id)) {
    return current.map((message) =>
      message.id === frame.id ? frame : message,
    );
  }
  if (plan && current.some((message) => message.id === plan.placeholder.id)) {
    return current.map((message) =>
      message.id === plan.placeholder.id ? frame : message,
    );
  }
  const targetPosition = current.findIndex(
    (message) => message.id === target.id,
  );
  if (target.role === "assistant") {
    if (targetPosition >= 0) {
      return current.map((message) =>
        message.id === target.id ? frame : message,
      );
    }
    const at = Math.min(Math.max(targetIndex, 0), current.length);
    return [...current.slice(0, at), frame, ...current.slice(at)];
  }
  const at =
    targetPosition >= 0
      ? targetPosition + 1
      : Math.min(Math.max(targetIndex + 1, 0), current.length);
  return [...current.slice(0, at), frame, ...current.slice(at)];
}
