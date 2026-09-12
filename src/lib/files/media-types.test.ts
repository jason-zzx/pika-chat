import { describe, expect, it } from "vitest";

import {
  classifyFile,
  FILE_URL_PREFIX,
  fileExtension,
  fileIdFromUrl,
  normalizeMediaType,
  SUPPORTED_FILE_ACCEPT,
} from "./media-types";

describe("normalizeMediaType", () => {
  it("lowercases and trims", () => {
    expect(normalizeMediaType("  IMAGE/PNG ")).toBe("image/png");
  });

  it("folds known client aliases onto canonical types", () => {
    expect(normalizeMediaType("image/jpg")).toBe("image/jpeg");
    expect(normalizeMediaType("application/x-pdf")).toBe("application/pdf");
  });
});

describe("fileExtension", () => {
  it("returns the lowercased extension", () => {
    expect(fileExtension("Report.PDF")).toBe("pdf");
    expect(fileExtension("/a/b/notes.md")).toBe("md");
  });

  it("returns an empty string when there is no extension", () => {
    expect(fileExtension("Dockerfile")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
  });
});

describe("classifyFile", () => {
  it("classifies whitelisted images", () => {
    for (const mediaType of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(classifyFile({ mediaType, filename: "x" })).toBe("image");
    }
  });

  it("classifies PDFs", () => {
    expect(
      classifyFile({ mediaType: "application/pdf", filename: "x.pdf" }),
    ).toBe("pdf");
  });

  it("classifies office documents", () => {
    expect(
      classifyFile({
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "x.docx",
      }),
    ).toBe("office");
    expect(
      classifyFile({
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "x.xlsx",
      }),
    ).toBe("office");
  });

  it("classifies plain text, data, and code by extension", () => {
    for (const filename of ["a.txt", "a.md", "a.csv", "a.ts", "a.py", "a.json"]) {
      expect(classifyFile({ mediaType: "application/octet-stream", filename })).toBe(
        "text",
      );
    }
  });

  it("classifies extensionless known text files", () => {
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "Dockerfile" }),
    ).toBe("text");
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "README" }),
    ).toBe("text");
  });

  it("classifies any text/* media type", () => {
    expect(
      classifyFile({ mediaType: "text/x-python", filename: "x" }),
    ).toBe("text");
  });

  it("does not trust the media type alone to smuggle an extension", () => {
    // A .png extension with a non-image media type must not become an image.
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "x.png" }),
    ).toBeNull();
  });

  it("rejects unsupported formats", () => {
    expect(classifyFile({ mediaType: "image/svg+xml", filename: "x.svg" })).toBeNull();
    expect(classifyFile({ mediaType: "application/zip", filename: "x.zip" })).toBeNull();
    expect(
      classifyFile({ mediaType: "application/msword", filename: "x.doc" }),
    ).toBeNull();
  });

  it("builds the file picker accept list from the same whitelist", () => {
    expect(SUPPORTED_FILE_ACCEPT).toContain("image/png");
    expect(SUPPORTED_FILE_ACCEPT).toContain("application/pdf");
    expect(SUPPORTED_FILE_ACCEPT).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(SUPPORTED_FILE_ACCEPT).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(SUPPORTED_FILE_ACCEPT).toContain(".md");
    // A format the classifier rejects must not be offered either.
    expect(SUPPORTED_FILE_ACCEPT).not.toContain(".zip");
  });

  it("extracts ids only from canonical attachment urls", () => {
    expect(fileIdFromUrl(`${FILE_URL_PREFIX}file-1`)).toBe("file-1");
    expect(fileIdFromUrl("/api/files/")).toBeNull();
    expect(fileIdFromUrl("https://evil.example/api/files/file-1")).toBeNull();
  });
});
