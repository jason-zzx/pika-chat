import { describe, expect, it } from "vitest";

import { buildPptx } from "@test/fixtures/pptx";

import { extractPptx } from "./pptx";

/** Page numbers of the `## Slide N` headings, in document order. */
function slideOrder(text: string): number[] {
  return [...text.matchAll(/^## Slide (\d+)$/gm)].map((match) =>
    Number(match[1] ?? 0),
  );
}

describe("extractPptx", () => {
  it("renders every slide as a numbered Markdown section", async () => {
    const result = await extractPptx(
      buildPptx([{ body: ["Agenda", "Budget"] }, { body: ["Roadmap"] }]),
    );
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(
      "## Slide 1\n\nAgenda\nBudget\n\n## Slide 2\n\nRoadmap",
    );
  });

  it("orders slides numerically so slide 10 follows slide 2", async () => {
    const slides = Array.from({ length: 10 }, (_, index) => ({
      body: [`body ${index + 1}`],
    }));
    const result = await extractPptx(buildPptx(slides));
    expect(result.status).toBe("ok");
    expect(slideOrder(result.text)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.text.indexOf("body 2")).toBeLessThan(
      result.text.indexOf("body 10"),
    );
  });

  it("appends speaker notes as a Notes subsection of their slide", async () => {
    const result = await extractPptx(
      buildPptx([
        { body: ["Agenda"], notes: ["Mention the deadline", "Keep it short"] },
        { body: ["Roadmap"] },
      ]),
    );
    expect(result.status).toBe("ok");
    expect(result.text).toBe(
      "## Slide 1\n\nAgenda\n\nNotes:\nMention the deadline\nKeep it short\n\n## Slide 2\n\nRoadmap",
    );
  });

  it("reports a deck without any text as empty", async () => {
    const result = await extractPptx(buildPptx([{ body: ["", "  "] }, {}]));
    expect(result.status).toBe("empty");
    expect(result.text).toBe("");
  });

  it("reports a deck without slides as empty", async () => {
    const result = await extractPptx(buildPptx([]));
    expect(result.status).toBe("empty");
  });

  it("reports a legacy binary .ppt as failed", async () => {
    // OLE2 compound-file signature: the old binary format we do not parse.
    const legacyPpt = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64),
    ]);
    const result = await extractPptx(legacyPpt);
    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error).toContain("not a pptx (zip) container");
  });

  it("reports a truncated zip as failed", async () => {
    const result = await extractPptx(
      Buffer.concat([buildPptx([{ body: ["Agenda"] }]).subarray(0, 20)]),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });
});
