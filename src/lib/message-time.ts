const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// en-US is pinned so labels are deterministic regardless of the runtime locale.
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const shortDateWithYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function parseTimestamp(
  iso: string | undefined,
): Date | undefined {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * Human label for a message age relative to `now` (ms epoch):
 * "just now" under a minute, "N minutes ago" under an hour,
 * "N hours ago" under a day, otherwise a short date ("Sep 3"),
 * with the year added when the message is from a different year.
 * Returns undefined for missing or invalid input.
 */
export function formatMessageAge(
  iso: string | undefined,
  now: number,
): string | undefined {
  const date = parseTimestamp(iso);
  if (!date) {
    return undefined;
  }
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} minutes ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} hours ago`;
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? shortDateFormatter.format(date)
    : shortDateWithYearFormatter.format(date);
}

/**
 * Exact local time "yyyy-MM-dd HH:mm:ss" (zero-padded) for the timestamp
 * tooltip. Returns undefined for missing or invalid input.
 */
export function formatMessageExact(
  iso: string | undefined,
): string | undefined {
  const date = parseTimestamp(iso);
  if (!date) {
    return undefined;
  }
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
  return `${day} ${time}`;
}
