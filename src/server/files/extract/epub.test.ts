import { describe, expect, it } from "vitest";

import { buildEpub } from "@test/fixtures/epub";

import { extractEpub } from "./epub";

describe("extractEpub", () => {
  it("concatenates chapters in spine order", async () => {
    const result = await extractEpub(
      buildEpub(
        [
          { id: "c1", body: "<h1>Chapter One</h1><p>first body</p>" },
          { id: "c2", body: "<h1>Chapter Two</h1><p>second body</p>" },
        ],
        { spine: ["c2", "c1"] },
      ),
    );
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("# Chapter One");
    expect(result.text).toContain("# Chapter Two");
    // Reading order comes from the spine, not from the manifest order.
    expect(result.text.indexOf("Chapter Two")).toBeLessThan(
      result.text.indexOf("Chapter One"),
    );
  });

  it("keeps chapter markup as Markdown", async () => {
    const result = await extractEpub(
      buildEpub([
        { id: "c1", body: "<h1>Title</h1><p>A <strong>bold</strong> claim.</p>" },
      ]),
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("# Title");
    expect(result.text).toContain("A **bold** claim.");
  });

  it("resolves chapter hrefs against the OPF directory", async () => {
    const result = await extractEpub(
      buildEpub(
        [
          { id: "c1", href: "chapter1.xhtml", body: "<p>deep chapter</p>" },
          { id: "c2", href: "text/chapter2.xhtml", body: "<p>nested chapter</p>" },
        ],
        { opfPath: "OEBPS/content.opf" },
      ),
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("deep chapter");
    expect(result.text).toContain("nested chapter");
  });

  it("decodes percent-encoded manifest hrefs to name archive entries", async () => {
    // OPF hrefs are URIs; a space in a chapter filename travels as `%20`.
    const result = await extractEpub(
      buildEpub([
        { id: "c1", href: "chapter%20one.xhtml", body: "<p>encoded href</p>" },
      ]),
    );
    expect(result.status).toBe("ok");
    expect(result.text).toContain("encoded href");
  });

  it("reports a book whose chapters carry no text as empty", async () => {
    const result = await extractEpub(
      buildEpub([{ id: "c1", body: "" }, { id: "c2", body: "<p></p>" }]),
    );
    expect(result.status).toBe("empty");
    expect(result.text).toBe("");
  });

  it("reports a missing container.xml as failed", async () => {
    const result = await extractEpub(
      buildEpub([{ id: "c1", body: "<p>orphan</p>" }], { omitContainer: true }),
    );
    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error).toContain("META-INF/container.xml");
  });

  it("reports a spine pointing at an unknown manifest id as failed", async () => {
    const result = await extractEpub(
      buildEpub([{ id: "c1", body: "<p>orphan</p>" }], { spine: ["missing"] }),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("spine");
  });

  it("reports a chapter declared but absent from the archive as failed", async () => {
    const result = await extractEpub(
      buildEpub([{ id: "c1", body: "<p>gone</p>", omitFile: true }]),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("missing epub chapter");
  });

  it("reports a non-zip payload as failed", async () => {
    const result = await extractEpub(Buffer.from("not an epub at all"));
    expect(result.status).toBe("failed");
    expect(result.error).toContain("not an epub (zip) container");
  });
});
