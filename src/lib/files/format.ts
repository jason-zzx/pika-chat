const UNITS = ["KB", "MB", "GB"] as const;

/** Human-readable file size (`340 KB`, `1.2 MB`). Isomorphic and locale-neutral. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}
