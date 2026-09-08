import { describe, expect, it } from "vitest";

import { createReasoningTimer, withReasoningDurations } from "./reasoning-timer";

function timerWithFakeClock() {
  let now = 1_000;
  return {
    advance: (ms: number) => {
      now += ms;
    },
    timer: createReasoningTimer(() => now),
  };
}

describe("createReasoningTimer", () => {
  it("measures from reasoning-start to reasoning-end", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(3_200);
    timer.onChunk({ type: "reasoning-end" });

    expect(timer.measure()).toBe(3_200);
  });

  it("falls back to the first reasoning-delta when there is no start", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-delta" });
    advance(500);
    timer.onChunk({ type: "reasoning-delta" });
    advance(2_700);
    timer.onChunk({ type: "reasoning-end" });

    expect(timer.measure()).toBe(3_200);
  });

  it("closes the measurement when the answer text starts", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(1_100);
    timer.onChunk({ type: "text-start" });

    expect(timer.measure()).toBe(1_100);
  });

  it("closes the measurement on a text delta after reasoning", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(900);
    timer.onChunk({ type: "text-delta" });

    expect(timer.measure()).toBe(900);
  });

  it("returns undefined when the model never reasoned", () => {
    const { timer } = timerWithFakeClock();
    timer.onChunk({ type: "text-start" });
    timer.onChunk({ type: "text-delta" });
    timer.onChunk({ type: "finish" });

    expect(timer.measure()).toBeUndefined();
  });

  it("returns undefined while reasoning has not ended", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(4_000);

    expect(timer.measure()).toBeUndefined();
  });

  it("treats finish as the end for streams aborted mid-thought", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(1_400);
    timer.onChunk({ type: "finish" });

    expect(timer.measure()).toBe(1_400);
  });

  it("keeps measuring later phases after the first one closed", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(2_000);
    timer.onChunk({ type: "reasoning-end" });
    advance(5_000);
    timer.onChunk({ type: "reasoning-delta" });
    timer.onChunk({ type: "text-delta" });
    timer.onChunk({ type: "finish" });

    // measure() totals all phases; the second phase took no fake-clock time.
    expect(timer.measure()).toBe(2_000);
    expect(timer.durations()).toEqual([2_000, 0]);
  });

  it("rounds sub-millisecond durations to whole milliseconds", () => {
    let ticks = 0;
    const timer = createReasoningTimer(() => {
      ticks += 1;
      return 1_000 + ticks * 333;
    });
    timer.onChunk({ type: "reasoning-start" });
    timer.onChunk({ type: "reasoning-end" });

    expect(timer.measure()).toBe(333);
  });
});

describe("createReasoningTimer multi-step phases", () => {
  it("measures every reasoning phase of a tool turn separately", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(2_000);
    timer.onChunk({ type: "reasoning-end" });
    advance(300);
    timer.onChunk({ type: "tool-call" });
    timer.onChunk({ type: "tool-result" });
    advance(100);
    timer.onChunk({ type: "reasoning-start" });
    advance(900);
    timer.onChunk({ type: "reasoning-end" });
    advance(50);
    timer.onChunk({ type: "text-delta" });
    timer.onChunk({ type: "finish" });

    expect(timer.durations()).toEqual([2_000, 900]);
    expect(timer.measure()).toBe(2_900);
  });

  it("closes a phase when reasoning flows into a tool call without text", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(1_200);
    timer.onChunk({ type: "tool-call" });

    expect(timer.durations()).toEqual([1_200]);
    expect(timer.measure()).toBe(1_200);
  });

  it("does not open a phase on tool or text chunks alone", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "tool-call" });
    timer.onChunk({ type: "tool-result" });
    advance(400);
    timer.onChunk({ type: "text-delta" });
    timer.onChunk({ type: "finish" });

    expect(timer.durations()).toEqual([]);
    expect(timer.measure()).toBeUndefined();
  });

  it("closes an open trailing phase on finish", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(800);
    timer.onChunk({ type: "reasoning-end" });
    timer.onChunk({ type: "tool-call" });
    timer.onChunk({ type: "tool-result" });
    timer.onChunk({ type: "reasoning-start" });
    advance(600);
    timer.onChunk({ type: "finish" });

    expect(timer.durations()).toEqual([800, 600]);
  });
});

describe("withReasoningDurations", () => {
  it("zips phase durations into reasoning parts in part order", () => {
    const parts = [
      { type: "reasoning", text: "first thought" },
      { type: "tool-searchWeb", toolCallId: "call-1" },
      { type: "reasoning", text: "second thought" },
      { type: "text", text: "answer" },
    ];

    expect(withReasoningDurations(parts, [2_000, 900])).toEqual([
      { type: "reasoning", text: "first thought", durationMs: 2_000 },
      { type: "tool-searchWeb", toolCallId: "call-1" },
      { type: "reasoning", text: "second thought", durationMs: 900 },
      { type: "text", text: "answer" },
    ]);
  });

  it("leaves extra reasoning parts untouched when fewer phases closed", () => {
    const parts = [
      { type: "reasoning", text: "first" },
      { type: "reasoning", text: "second" },
    ];

    expect(withReasoningDurations(parts, [2_000])).toEqual([
      { type: "reasoning", text: "first", durationMs: 2_000 },
      { type: "reasoning", text: "second" },
    ]);
  });

  it("returns the parts unchanged when no phase was measured", () => {
    const parts = [{ type: "text", text: "answer" }];

    expect(withReasoningDurations(parts, [])).toBe(parts);
  });
});
