import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  localStreamingTopics,
  markTopicStreaming,
  resetStreamingTopics,
  syncServerStreamingTopics,
  unmarkTopicStreaming,
  useStreamingTopics,
} from "@/lib/streaming-topics";

beforeEach(() => resetStreamingTopics());

describe("server generation spinner reconciliation", () => {
  it("removes an offline generation after the server reports completion", () => {
    const { result } = renderHook(useStreamingTopics);
    act(() => syncServerStreamingTopics(["remote"], localStreamingTopics()));
    expect(result.current.has("remote")).toBe(true);
    expect(localStreamingTopics().has("remote")).toBe(false);
    act(() => syncServerStreamingTopics([], localStreamingTopics()));
    expect(result.current.has("remote")).toBe(false);
  });

  it("preserves a local subscription across a stale discovery result", () => {
    const { result } = renderHook(useStreamingTopics);
    act(() => markTopicStreaming("local"));
    act(() => syncServerStreamingTopics([], localStreamingTopics()));
    expect(result.current.has("local")).toBe(true);
    act(() => unmarkTopicStreaming("local"));
    act(() => syncServerStreamingTopics([], localStreamingTopics()));
    expect(result.current.size).toBe(0);
    expect(localStreamingTopics().size).toBe(0);
  });
});
