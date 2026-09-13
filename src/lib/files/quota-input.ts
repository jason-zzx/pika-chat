import { MAX_QUOTA_MB } from "@/lib/files/constants";

/**
 * Parses a quota input in MB, shared by the instance-default card and the
 * per-user override dialog so both agree on what "blank" and "invalid" mean.
 *
 * - blank → `null` (clear the value / unlimited)
 * - non-negative integer within {@link MAX_QUOTA_MB} → the number
 * - everything else → `undefined`, which callers treat as "block submit"
 */
export function parseQuotaMb(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_QUOTA_MB) {
    return undefined;
  }
  return parsed;
}
