import "server-only";

/**
 * Minimal shape of the streamText chunks the timer cares about; the full
 * TextStreamPart union is intentionally not required so the timer stays
 * unit-testable without the SDK.
 */
type TimerChunk = { type: string };

export type ReasoningTimer = {
  /** Feed one streamText chunk into the timer. */
  onChunk: (chunk: TimerChunk) => void;
  /**
   * Reasoning duration in ms once reasoning has started and ended;
   * undefined while unknown (no reasoning, or still thinking).
   */
  measure: () => number | undefined;
};

/**
 * Measures how long the reasoning phase of one assistant turn lasted, from
 * the streamText chunks the route already observes. The server owns the only
 * clock so the duration survives reloads and cannot drift with client time.
 *
 * The measurement opens on the first `reasoning-start` (falling back to the
 * first `reasoning-delta` for providers that skip the explicit start) and
 * closes on `reasoning-end` or on the first answer text after it. A `finish`
 * chunk closes an open measurement so streams stopped mid-thought still get
 * a duration.
 */
export function createReasoningTimer(
  now: () => number = Date.now,
): ReasoningTimer {
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  function onChunk(chunk: TimerChunk): void {
    if (startedAt === undefined) {
      if (chunk.type === "reasoning-start" || chunk.type === "reasoning-delta") {
        startedAt = now();
      }
      return;
    }
    if (endedAt !== undefined) {
      return;
    }
    if (
      chunk.type === "reasoning-end" ||
      chunk.type === "text-start" ||
      chunk.type === "text-delta"
    ) {
      endedAt = now();
      return;
    }
    if (chunk.type === "finish") {
      endedAt = now();
    }
  }

  function measure(): number | undefined {
    if (startedAt === undefined || endedAt === undefined) {
      return undefined;
    }
    return Math.round(endedAt - startedAt);
  }

  return { onChunk, measure };
}
