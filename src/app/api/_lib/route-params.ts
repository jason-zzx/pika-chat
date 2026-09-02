import { AppError } from "@/server/errors";

type RouteContext = { params: Promise<Record<string, string>> } | undefined;

/**
 * Reads a dynamic segment, treating a missing one as a miss rather than a 500 —
 * an unroutable id and an id nobody owns look the same to the caller.
 */
export async function requireParam(
  context: RouteContext,
  name: string,
  notFoundMessage: string,
): Promise<string> {
  const value = (await context?.params)?.[name];
  if (!value) {
    throw new AppError("NOT_FOUND", 404, notFoundMessage);
  }
  return value;
}
