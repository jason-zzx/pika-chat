import { describe, expect, it, vi } from "vitest";

import { withDisconnectAbort } from "./disconnect-abort";

function streamOf<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("withDisconnectAbort", () => {
  it("passes chunks through untouched", async () => {
    const onCancel = vi.fn();
    const stream = withDisconnectAbort(streamOf(["a", "b", "c"]), onCancel);

    const reader = stream.getReader();
    const received: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received.push(value);
    }

    expect(received).toEqual(["a", "b", "c"]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("invokes onCancel when the consumer cancels mid-stream", async () => {
    const onCancel = vi.fn();
    // A stream that never finishes on its own, like an in-flight provider
    // response.
    const source = new ReadableStream<string>({ start: () => {} });
    const stream = withDisconnectAbort(source, onCancel);

    const reader = stream.getReader();
    await reader.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when the response body is cancelled (pipe chain)", async () => {
    // Mirrors createUIMessageStreamResponse: the route's stream is piped
    // through transforms into the response body; cancelling the body reader
    // must reach the wrapped transform's cancel.
    const onCancel = vi.fn();
    const source = new ReadableStream<string>({ start: () => {} });
    const body = withDisconnectAbort(source, onCancel).pipeThrough(
      new TransformStream<string, string>(),
    );

    const reader = body.getReader();
    await reader.cancel();

    // Cancel propagation upstream through the pipe chain is asynchronous.
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
