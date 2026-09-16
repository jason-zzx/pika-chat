import "server-only";

import { isUniqueViolation } from "@/server/db/unique-violation";

const MAX_ATTEMPTS = 3;

/**
 * Inserts a row keyed by a random short id, re-minting the id and retrying
 * when the insert hits a unique violation. ~71 bits of entropy make a primary
 * key collision vanishingly rare; the retry turns a would-be 500 into a
 * transparent re-mint. A genuine user-facing conflict (e.g. duplicate name)
 * is retried pointlessly a couple of times, then rethrown unchanged.
 */
export async function insertWithShortId<T>(args: {
  mint: () => string;
  insert: (id: string) => Promise<T>;
}): Promise<{ id: string; result: T }> {
  for (let attempt = 0; ; attempt += 1) {
    const id = args.mint();
    try {
      return { id, result: await args.insert(id) };
    } catch (error) {
      const canRetry = attempt + 1 < MAX_ATTEMPTS && isUniqueViolation(error);
      if (!canRetry) {
        throw error;
      }
    }
  }
}
