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
   * Total reasoning duration in ms across all measured phases, once at
   * least one phase has started and ended; undefined while unknown (no
   * reasoning finished, or the first phase is still thinking).
   */
  measure: () => number | undefined;
  /**
   * Per-phase durations in phase order, one entry per reasoning phase that
   * has ended. A multi-step tool turn produces one phase per step.
   */
  durations: () => number[];
};

function closesPhase(chunk: TimerChunk): boolean {
  return (
    chunk.type === "reasoning-end" ||
    chunk.type === "text-start" ||
    chunk.type === "text-delta" ||
    chunk.type === "finish" ||
    // A tool invocation after reasoning ends that step's thinking phase
    // (the model decided to act instead of answering).
    chunk.type.startsWith("tool-")
  );
}

/**
 * Measures how long each reasoning phase of one assistant turn lasted, from
 * the streamText chunks the route already observes. The server owns the only
 * clock so the durations survive reloads and cannot drift with client time.
 *
 * A phase opens on `reasoning-start` (falling back to the first
 * `reasoning-delta` for providers that skip the explicit start) and closes on
 * `reasoning-end`, on the first answer text after it, or on a tool chunk (the
 * model chose to call a tool instead of answering). A `finish` chunk closes
 * an open phase so streams stopped mid-thought still get a duration. Later
 * reasoning chunks open a new phase, so every step of a multi-step tool turn
 * is measured separately.
 */
export function createReasoningTimer(
  now: () => number = Date.now,
): ReasoningTimer {
  const closedDurations: number[] = [];
  let openStartedAt: number | undefined;

  function onChunk(chunk: TimerChunk): void {
    if (openStartedAt === undefined) {
      if (chunk.type === "reasoning-start" || chunk.type === "reasoning-delta") {
        openStartedAt = now();
      }
      return;
    }
    if (closesPhase(chunk)) {
      closedDurations.push(Math.round(now() - openStartedAt));
      openStartedAt = undefined;
    }
  }

  function durations(): number[] {
    return [...closedDurations];
  }

  function measure(): number | undefined {
    if (closedDurations.length === 0) {
      return undefined;
    }
    return closedDurations.reduce((total, duration) => total + duration, 0);
  }

  return { onChunk, measure, durations };
}

type ReasoningPartLike = { type: string; durationMs?: number };

/**
 * Zips per-phase durations into a message's reasoning parts in part order
 * (phase i → reasoning part i), returning a new parts array. Persisted this
 * way the durations survive reloads without a dedicated column. Phases and
 * reasoning parts correspond 1:1 in a step-turn stream; extra phases or
 * extra parts are left unmatched rather than shifting the alignment.
 */
export function withReasoningDurations<T extends ReasoningPartLike>(
  parts: T[],
  phaseDurations: number[],
): T[] {
  if (phaseDurations.length === 0) {
    return parts;
  }
  let phase = 0;
  return parts.map((part) => {
    if (part.type !== "reasoning" || phase >= phaseDurations.length) {
      return part;
    }
    const durationMs = phaseDurations[phase];
    phase += 1;
    return durationMs === undefined ? part : { ...part, durationMs };
  });
}
