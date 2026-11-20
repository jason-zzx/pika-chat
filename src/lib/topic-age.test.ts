import { describe, expect, it } from "vitest";

import { formatTopicAge } from "./topic-age";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 19);

const age = (elapsed: number) => formatTopicAge(new Date(NOW - elapsed), NOW);

describe("formatTopicAge", () => {
  it.each([
    [0, { unit: "now", n: 0 }],
    [MINUTE - 1, { unit: "now", n: 0 }],
    [MINUTE, { unit: "m", n: 1 }],
    [HOUR - 1, { unit: "m", n: 59 }],
    [HOUR, { unit: "h", n: 1 }],
    [DAY - 1, { unit: "h", n: 23 }],
    [DAY, { unit: "d", n: 1 }],
    [7 * DAY - 1, { unit: "d", n: 6 }],
    [7 * DAY, { unit: "w", n: 1 }],
    [30 * DAY - 1, { unit: "w", n: 4 }],
    [30 * DAY, { unit: "mo", n: 1 }],
    [364 * DAY, { unit: "mo", n: 11 }],
    [365 * DAY - 1, { unit: "mo", n: 11 }],
    [365 * DAY, { unit: "date" }],
  ])("elapsed %d ms", (elapsed, expected) => {
    expect(age(elapsed)).toEqual(expected);
  });

  it("treats a future timestamp as now", () => {
    expect(age(-5 * MINUTE)).toEqual({ unit: "now", n: 0 });
  });
});
