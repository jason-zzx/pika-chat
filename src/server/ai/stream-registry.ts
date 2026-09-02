import "server-only";

const streams = new Map<
  string,
  { controller: AbortController; userId: string }
>();

export function registerStream(streamId: string, userId: string): AbortSignal {
  const controller = new AbortController();
  streams.set(streamId, { controller, userId });
  return controller.signal;
}

export function abortStream(streamId: string, userId: string): boolean {
  const entry = streams.get(streamId);
  if (!entry || entry.userId !== userId) {
    return false;
  }
  entry.controller.abort();
  return true;
}

export function releaseStream(streamId: string): void {
  streams.delete(streamId);
}
