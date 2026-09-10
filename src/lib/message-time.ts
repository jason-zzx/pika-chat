const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Locale-agnostic age of a message, ready to be rendered through the
 * `Chat.Timestamp` catalog: `justNow` / `minutes` / `hours` labels, or a
 * short date (with the year when the message is from a different year).
 */
export type MessageAge =
  | { kind: "justNow" }
  | { kind: "minutes"; count: number }
  | { kind: "hours"; count: number }
  | { kind: "date"; date: Date; withYear: boolean };

export function parseTimestamp(iso: string | undefined): Date | undefined {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Buckets a message age relative to `now` (ms epoch): just now under a
 * minute, `minutes` under an hour, `hours` under a day, otherwise a short
 * date, with the year added when the message is from a different year.
 * Future timestamps (clock skew) count as just now. Returns undefined for
 * missing or invalid input.
 */
export function getMessageAge(
  iso: string | undefined,
  now: number,
): MessageAge | undefined {
  const date = parseTimestamp(iso);
  if (!date) {
    return undefined;
  }
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE_MS) {
    return { kind: "justNow" };
  }
  if (elapsed < HOUR_MS) {
    return { kind: "minutes", count: Math.floor(elapsed / MINUTE_MS) };
  }
  if (elapsed < DAY_MS) {
    return { kind: "hours", count: Math.floor(elapsed / HOUR_MS) };
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return { kind: "date", date, withYear: !sameYear };
}
