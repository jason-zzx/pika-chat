import "server-only";

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "23505"
    ) {
      return true;
    }
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}
