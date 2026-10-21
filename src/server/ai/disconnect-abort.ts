import "server-only";

/**
 * Invokes `onCancel` when the downstream consumer cancels the stream — for a
 * route response that means the client disconnected (page refresh, tab
 * close). SPA navigations do not abort the in-flight fetch, so this never
 * fires for background streams the client may resume.
 *
 * Wire it to `abortStream` so a disconnected turn also severs the provider
 * connection instead of burning tokens on a stream nobody can read. The UI
 * stream's own `cancel` hook still runs first, persisting the partial message
 * exactly once (its `finishCalled` guard makes the later abort-driven end a
 * no-op).
 */
export function withDisconnectAbort<T>(
  stream: ReadableStream<T>,
  onCancel: () => void,
): ReadableStream<T> {
  return stream.pipeThrough(
    new TransformStream<T, T>({
      // No `transform`: the default is the identity pass-through.
      // @ts-expect-error cancel is still new and missing from the types
      // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream#browser_compatibility
      cancel() {
        onCancel();
      },
    }),
  );
}
