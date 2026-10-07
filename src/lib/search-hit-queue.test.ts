import { describe, expect, it } from "vitest";

import { parseHitQueue } from "./search-hit-queue";

const RAW = JSON.stringify({
  topicId: "t1",
  hits: ["g2", "g1", "g0"],
  current: "g1",
});

describe("parseHitQueue", () => {
  it("returns the hits and the clicked hit's index", () => {
    expect(parseHitQueue(RAW, "t1", "g1")).toEqual({
      hits: ["g2", "g1", "g0"],
      index: 1,
    });
  });

  it("falls back to the jumped key when current is not among the hits", () => {
    const raw = JSON.stringify({ topicId: "t1", hits: ["g2", "g1"], current: "gone" });
    expect(parseHitQueue(raw, "t1", "g1")).toEqual({
      hits: ["g2", "g1"],
      index: 1,
    });
  });

  it("drops the queue when nothing was stashed", () => {
    expect(parseHitQueue(null, "t1", "g1")).toBeNull();
  });

  it("drops a queue stashed for another topic", () => {
    expect(parseHitQueue(RAW, "other-topic", "g1")).toBeNull();
  });

  it("drops a queue whose hits do not include the jumped message", () => {
    expect(parseHitQueue(RAW, "t1", "unrelated")).toBeNull();
  });

  it("drops malformed payloads", () => {
    expect(parseHitQueue("not json", "t1", "g1")).toBeNull();
    expect(parseHitQueue('{"topicId":"t1"}', "t1", "g1")).toBeNull();
  });
});
