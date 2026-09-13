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
  it("folds audio/video aliases onto canonical types", () => {
    expect(normalizeMediaType("audio/x-m4a")).toBe("audio/mp4");
    expect(normalizeMediaType("audio/x-flac")).toBe("audio/flac");
    expect(normalizeMediaType("video/x-quicktime")).toBe("video/quicktime");
    // The only wav spelling the openai-compatible `input_audio` wire format
    // accepts; the router's serialization gate depends on this fold.
    expect(normalizeMediaType("audio/x-wav")).toBe("audio/wav");
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

  it("classifies pptx as office and epub as ebook", () => {
    expect(
      classifyFile({
        mediaType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename: "deck.pptx",
      }),
    ).toBe("office");
    expect(
      classifyFile({ mediaType: "application/epub+zip", filename: "book.epub" }),
    ).toBe("ebook");
  });

  it("falls back to the extension when the browser sends no usable type", () => {
    // Browsers report an empty or generic media type for these two often.
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "deck.pptx" }),
    ).toBe("office");
    expect(classifyFile({ mediaType: "", filename: "book.epub" })).toBe("ebook");
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
    // Legacy binary .ppt: an OLE container we deliberately do not parse.
    expect(
      classifyFile({ mediaType: "application/vnd.ms-powerpoint", filename: "x.ppt" }),
    ).toBeNull();
  });

  it("classifies whitelisted audio as audio", () => {
    for (const mediaType of [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
      "audio/flac",
      "audio/webm",
    ]) {
      expect(classifyFile({ mediaType, filename: "x" })).toBe("audio");
    }
  });

  it("classifies whitelisted video as video", () => {
    for (const mediaType of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(classifyFile({ mediaType, filename: "x" })).toBe("video");
    }
  });

  it("falls back to the extension for media with no reported type", () => {
    expect(classifyFile({ mediaType: "", filename: "song.mp3" })).toBe("audio");
    expect(classifyFile({ mediaType: "", filename: "voice.m4a" })).toBe("audio");
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "clip.mp4" }),
    ).toBe("video");
    expect(
      classifyFile({ mediaType: "application/octet-stream", filename: "clip.mov" }),
    ).toBe("video");
  });

  it("rejects media formats outside the whitelist", () => {
    // No codec container we can hand to a provider, and no extraction path.
    expect(
      classifyFile({ mediaType: "audio/x-ms-wma", filename: "x.wma" }),
    ).toBeNull();
    expect(
      classifyFile({ mediaType: "video/x-msvideo", filename: "x.avi" }),
    ).toBeNull();
    expect(
      classifyFile({ mediaType: "video/x-matroska", filename: "x.mkv" }),
    ).toBeNull();
  });

  it("does not let a media extension outrank a recognized media type", () => {
    // A .mp4 extension is only consulted when the reported type is unusable.
    expect(classifyFile({ mediaType: "audio/mpeg", filename: "x.mp4" })).toBe(
      "audio",
    );
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
    expect(SUPPORTED_FILE_ACCEPT).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(SUPPORTED_FILE_ACCEPT).toContain("application/epub+zip");
    expect(SUPPORTED_FILE_ACCEPT).toContain("audio/mpeg");
    expect(SUPPORTED_FILE_ACCEPT).toContain("video/mp4");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".md");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".pptx");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".epub");
    // Media browsers report as an empty type must still be pickable.
    expect(SUPPORTED_FILE_ACCEPT).toContain(".mp3");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".m4a");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".mp4");
    expect(SUPPORTED_FILE_ACCEPT).toContain(".mov");
    // A format the classifier rejects must not be offered either.
    expect(SUPPORTED_FILE_ACCEPT).not.toContain(".zip");
    expect(SUPPORTED_FILE_ACCEPT).not.toContain(".mkv");
  });

  it("offers an extension only when the classifier accepts it too", () => {
    // The two lists are generated from the same whitelist, but a hand-edited
    // entry would drift — assert every offered extension actually classifies.
    for (const token of SUPPORTED_FILE_ACCEPT.split(",")) {
      if (!token.startsWith(".")) {
        continue;
      }
      expect(classifyFile({ mediaType: "", filename: `x${token}` })).not.toBeNull();
    }
  });

  it("extracts ids only from canonical attachment urls", () => {
    expect(fileIdFromUrl(`${FILE_URL_PREFIX}file-1`)).toBe("file-1");
    expect(fileIdFromUrl("/api/files/")).toBeNull();
    expect(fileIdFromUrl("https://evil.example/api/files/file-1")).toBeNull();
  });
});
