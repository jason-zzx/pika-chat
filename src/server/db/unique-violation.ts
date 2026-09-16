import "server-only";

function walkCauseChain(
  error: unknown,
  visit: (node: Record<string, unknown>) => boolean,
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if (visit(current as Record<string, unknown>)) {
        return true;
      }
      if ("cause" in current) {
        current = current.cause;
        continue;
      }
    }
    break;
  }
  return false;
}

export function isUniqueViolation(error: unknown): boolean {
  return walkCauseChain(error, (node) => node.code === "23505");
}
