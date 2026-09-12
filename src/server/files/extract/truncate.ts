import "server-only";

import { MAX_EXTRACTED_CHARS } from "@/lib/files/constants";

/** Clips `text` to `limit` characters, reporting whether clipping happened. */
export function truncateText(
  text: string,
  limit: number = MAX_EXTRACTED_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

/** Human-readable failure detail for logs (never shown to users). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
