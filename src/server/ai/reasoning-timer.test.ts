import { describe, expect, it } from "vitest";

import { createReasoningTimer } from "./reasoning-timer";

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

  it("keeps the first measurement and ignores later chunks", () => {
    const { advance, timer } = timerWithFakeClock();
    timer.onChunk({ type: "reasoning-start" });
    advance(2_000);
    timer.onChunk({ type: "reasoning-end" });
    advance(5_000);
    timer.onChunk({ type: "reasoning-delta" });
    timer.onChunk({ type: "text-delta" });
    timer.onChunk({ type: "finish" });

    expect(timer.measure()).toBe(2_000);
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
