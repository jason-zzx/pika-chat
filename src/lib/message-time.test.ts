import { describe, expect, it } from "vitest";

import { formatMessageAge, formatMessageExact } from "./message-time";

// Built from local components so the assertions hold in every timezone.
const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

function isoAt(date: Date): string {
  return date.toISOString();
}

describe("formatMessageAge", () => {
  it("says just now under a minute", () => {
    const iso = isoAt(new Date(NOW - 30_000));
    expect(formatMessageAge(iso, NOW)).toBe("just now");
  });

  it("says just now for future timestamps (clock skew)", () => {
    const iso = isoAt(new Date(NOW + 120_000));
    expect(formatMessageAge(iso, NOW)).toBe("just now");
  });

  it("counts minutes under an hour", () => {
    expect(
      formatMessageAge(isoAt(new Date(NOW - 5 * 60_000)), NOW),
    ).toBe("5 minutes ago");
    expect(
      formatMessageAge(isoAt(new Date(NOW - 59 * 60_000)), NOW),
    ).toBe("59 minutes ago");
  });

  it("counts hours under a day", () => {
    expect(
      formatMessageAge(isoAt(new Date(NOW - 60 * 60_000)), NOW),
    ).toBe("1 hours ago");
    expect(
      formatMessageAge(isoAt(new Date(NOW - 23 * 3_600_000)), NOW),
    ).toBe("23 hours ago");
  });

  it("uses a short date at or beyond a day in the same year", () => {
    const iso = isoAt(new Date(2026, 8, 3, 12, 0, 0));
    expect(formatMessageAge(iso, NOW)).toBe("Sep 3");
  });

  it("adds the year for messages from a different year", () => {
    const iso = isoAt(new Date(2025, 8, 3, 12, 0, 0));
    expect(formatMessageAge(iso, NOW)).toBe("Sep 3, 2025");
  });

  it("returns undefined for missing or invalid input", () => {
    expect(formatMessageAge(undefined, NOW)).toBeUndefined();
    expect(formatMessageAge("", NOW)).toBeUndefined();
    expect(formatMessageAge("not-a-date", NOW)).toBeUndefined();
  });
});

describe("formatMessageExact", () => {
  it("renders local time as zero-padded yyyy-MM-dd HH:mm:ss", () => {
    const iso = isoAt(new Date(2026, 8, 3, 9, 7, 5));
    expect(formatMessageExact(iso)).toBe("2026-09-03 09:07:05");
  });

  it("pads single-digit months, days, and time units", () => {
    const iso = isoAt(new Date(2026, 0, 5, 23, 59, 9));
    expect(formatMessageExact(iso)).toBe("2026-01-05 23:59:09");
  });

  it("returns undefined for missing or invalid input", () => {
    expect(formatMessageExact(undefined)).toBeUndefined();
    expect(formatMessageExact("")).toBeUndefined();
    expect(formatMessageExact("not-a-date")).toBeUndefined();
  });
});
