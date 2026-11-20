export type TopicAge =
  | { unit: "date" }
  | { unit: "now" | "m" | "h" | "d" | "w" | "mo"; n: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatTopicAge(updatedAt: Date, now: number): TopicAge {
  const elapsed = Math.max(0, now - updatedAt.getTime());
  const days = Math.floor(elapsed / DAY);
  if (elapsed < MINUTE) {
    return { unit: "now", n: 0 };
  }
  if (elapsed < HOUR) {
    return { unit: "m", n: Math.floor(elapsed / MINUTE) };
  }
  if (elapsed < DAY) {
    return { unit: "h", n: Math.floor(elapsed / HOUR) };
  }
  if (days < 7) {
    return { unit: "d", n: days };
  }
  if (days < 30) {
    return { unit: "w", n: Math.floor(days / 7) };
  }
  if (days < 365) {
    return { unit: "mo", n: Math.min(11, Math.floor(days / 30)) };
  }
  return { unit: "date" };
}
