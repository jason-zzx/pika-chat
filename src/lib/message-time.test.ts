import { describe, expect, it } from "vitest";

import { getMessageAge, parseTimestamp } from "./message-time";

// Built from local components so the assertions hold in every timezone.
const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

function isoAt(date: Date): string {
  return date.toISOString();
}

describe("getMessageAge", () => {
  it("buckets under a minute as just now", () => {
    expect(getMessageAge(isoAt(new Date(NOW - 30_000)), NOW)).toEqual({
      kind: "justNow",
    });
  });

  it("buckets future timestamps (clock skew) as just now", () => {
    expect(getMessageAge(isoAt(new Date(NOW + 120_000)), NOW)).toEqual({
      kind: "justNow",
    });
  });

  it("counts minutes under an hour", () => {
    expect(getMessageAge(isoAt(new Date(NOW - 5 * 60_000)), NOW)).toEqual({
      kind: "minutes",
      count: 5,
    });
    expect(getMessageAge(isoAt(new Date(NOW - 59 * 60_000)), NOW)).toEqual({
      kind: "minutes",
      count: 59,
    });
  });

  it("counts hours under a day", () => {
    expect(getMessageAge(isoAt(new Date(NOW - 60 * 60_000)), NOW)).toEqual({
      kind: "hours",
      count: 1,
    });
    expect(getMessageAge(isoAt(new Date(NOW - 23 * 3_600_000)), NOW)).toEqual({
      kind: "hours",
      count: 23,
    });
  });

  it("returns a short-date descriptor at or beyond a day in the same year", () => {
    const date = new Date(2026, 8, 3, 12, 0, 0);
    expect(getMessageAge(isoAt(date), NOW)).toEqual({
      kind: "date",
      date,
      withYear: false,
    });
  });

  it("flags the year for messages from a different year", () => {
    const date = new Date(2025, 8, 3, 12, 0, 0);
    expect(getMessageAge(isoAt(date), NOW)).toEqual({
      kind: "date",
      date,
      withYear: true,
    });
  });

  it("returns undefined for missing or invalid input", () => {
    expect(getMessageAge(undefined, NOW)).toBeUndefined();
    expect(getMessageAge("", NOW)).toBeUndefined();
    expect(getMessageAge("not-a-date", NOW)).toBeUndefined();
  });
});

describe("parseTimestamp", () => {
  it("parses valid input and rejects missing or invalid input", () => {
    const date = new Date(2026, 8, 3, 9, 7, 5);
    expect(parseTimestamp(date.toISOString())?.getTime()).toBe(date.getTime());
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp("")).toBeUndefined();
    expect(parseTimestamp("not-a-date")).toBeUndefined();
  });
});
