import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadChatFile, uploadChatFileDirect, deleteChatFile, fetchFileLimits } =
  vi.hoisted(() => ({
    uploadChatFile: vi.fn(),
    uploadChatFileDirect: vi.fn(),
    deleteChatFile: vi.fn(),
    fetchFileLimits: vi.fn(),
  }));

vi.mock("@/lib/api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/files")>();
  return {
    ...actual,
    uploadChatFile,
    uploadChatFileDirect,
    deleteChatFile,
    fetchFileLimits,
  };
});

import { DEFAULT_FILE_LIMITS } from "@/lib/api/files";
import {
  DEFAULT_MAX_FILE_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/files/constants";
import { useComposerStore } from "@/stores/composer-store";

import { useComposerAttachments } from "./use-composer-attachments";

const KEY = "topic:one";

function uploaded(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    url: "/api/files/file-1",
    filename: "notes.txt",
    mediaType: "text/plain",
    sizeBytes: 12,
    extraction: { status: "ok", truncated: false },
    ...overrides,
  };
}

function textFile(name = "notes.txt"): File {
  return new File(["hello"], name, { type: "text/plain" });
}

/** A File whose declared size is overridden (avoid allocating 20 MiB). */
function sizedFile(name: string, size: number): File {
  const file = textFile(name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function messageKeyOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("error" in error)) {
    return undefined;
  }
  const wrapped = (error as { error?: { messageKey?: string } }).error;
  return wrapped?.messageKey;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFileLimits.mockResolvedValue(DEFAULT_FILE_LIMITS);
  useComposerStore.setState({ attachments: {}, drafts: {} });
});

describe("useComposerAttachments", () => {
  it("uploads a selected file and exposes the canonical url and extraction", async () => {
    uploadChatFile.mockResolvedValue(uploaded());
    const { result } = renderHook(() => useComposerAttachments(KEY));

    act(() => {
      result.current.addFiles([textFile()]);
    });
    expect(result.current.attachments[0]?.status).toBe("uploading");

    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );
    expect(result.current.attachments[0]).toMatchObject({
      url: "/api/files/file-1",
      extraction: { status: "ok", truncated: false },
    });
  });

  it("records a failed upload as a retryable error chip", async () => {
    const envelope = {
      error: { code: "VALIDATION_FAILED", messageKey: "file.tooLarge" },
    };
    uploadChatFile.mockRejectedValue(envelope);
    const { result } = renderHook(() => useComposerAttachments(KEY));

    act(() => {
      result.current.addFiles([textFile()]);
    });

    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("error"),
    );
    expect(result.current.attachments[0]?.error).toBe(envelope);

    uploadChatFile.mockResolvedValue(uploaded());
    act(() => {
      result.current.retryAttachment(result.current.attachments[0]!.id);
    });
    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );
    expect(uploadChatFile).toHaveBeenCalledTimes(2);
  });

  it("deletes the uploaded object when a ready chip is removed", async () => {
    uploadChatFile.mockResolvedValue(uploaded());
    deleteChatFile.mockResolvedValue(undefined);
    const { result } = renderHook(() => useComposerAttachments(KEY));
    act(() => {
      result.current.addFiles([textFile()]);
    });
    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );

    act(() => {
      result.current.removeAttachment(result.current.attachments[0]!.id);
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(deleteChatFile).toHaveBeenCalledWith("file-1");
  });

  it("ignores a 409 when removing an already-referenced file", async () => {
    uploadChatFile.mockResolvedValue(uploaded());
    deleteChatFile.mockRejectedValue({
      error: { code: "CONFLICT", messageKey: "file.inUse" },
    });
    const { result } = renderHook(() => useComposerAttachments(KEY));
    act(() => {
      result.current.addFiles([textFile()]);
    });
    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );

    act(() => {
      result.current.removeAttachment(result.current.attachments[0]!.id);
    });

    // The chip is gone and no unhandled rejection escapes.
    expect(result.current.attachments).toHaveLength(0);
  });

  it("rejects unsupported and oversized files client-side without uploading", async () => {
    const { result } = renderHook(() => useComposerAttachments(KEY));

    act(() => {
      result.current.addFiles([
        new File(["x"], "program.exe", { type: "application/octet-stream" }),
      ]);
    });
    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("error"),
    );
    expect(result.current.attachments[0]?.error).toMatchObject({
      error: { messageKey: "file.unsupportedType" },
    });
    expect(uploadChatFile).not.toHaveBeenCalled();
  });

  it("marks files beyond the per-message cap as too many", async () => {
    const { result } = renderHook(() => useComposerAttachments(KEY));
    const files = Array.from(
      { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
      (_unused, index) => textFile(`note-${index}.txt`),
    );
    uploadChatFile.mockResolvedValue(uploaded());

    act(() => {
      result.current.addFiles(files);
    });

    await waitFor(() =>
      expect(result.current.attachments).toHaveLength(
        MAX_ATTACHMENTS_PER_MESSAGE + 1,
      ),
    );
    const overflow =
      result.current.attachments[MAX_ATTACHMENTS_PER_MESSAGE]!;
    expect(overflow.status).toBe("error");
    expect(overflow.error).toMatchObject({
      error: { messageKey: "file.tooMany" },
    });
    expect(uploadChatFile).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it("does not let a rejected file consume an attachment slot", async () => {
    const { result } = renderHook(() => useComposerAttachments(KEY));
    const files = [
      sizedFile("big.txt", DEFAULT_MAX_FILE_BYTES + 1),
      ...Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_unused, index) =>
        textFile(`note-${index}.txt`),
      ),
    ];
    uploadChatFile.mockResolvedValue(uploaded());

    act(() => {
      result.current.addFiles(files);
    });

    await waitFor(() =>
      expect(result.current.attachments).toHaveLength(
        MAX_ATTACHMENTS_PER_MESSAGE + 1,
      ),
    );
    // The oversized file is rejected, but the five valid ones still get a slot.
    expect(messageKeyOf(result.current.attachments[0]?.error)).toBe(
      "file.tooLarge",
    );
    expect(uploadChatFile).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(
      result.current.attachments.map((entry) => messageKeyOf(entry.error)),
    ).not.toContain("file.tooMany");
  });

  it("uses the size limit reported by the server", async () => {
    fetchFileLimits.mockResolvedValue({
      ...DEFAULT_FILE_LIMITS,
      maxFileBytes: 1000,
    });
    const { result } = renderHook(() => useComposerAttachments(KEY));
    // Flush the mount fetch so the tightened limit is in effect.
    await act(async () => {});

    act(() => {
      result.current.addFiles([sizedFile("big.txt", 1001)]);
    });

    expect(result.current.attachments[0]?.error).toMatchObject({
      error: { messageKey: "file.tooLarge", params: { limit: "1000 B" } },
    });
    expect(uploadChatFile).not.toHaveBeenCalled();
  });

  it("uses the direct transport when the server advertises it", async () => {
    fetchFileLimits.mockResolvedValue({
      ...DEFAULT_FILE_LIMITS,
      directUpload: true,
    });
    uploadChatFileDirect.mockResolvedValue(uploaded());
    const { result } = renderHook(() => useComposerAttachments(KEY));
    // Flush the mount fetch so the direct flag is in effect before upload.
    await act(async () => {});

    act(() => {
      result.current.addFiles([textFile()]);
    });

    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );
    expect(uploadChatFileDirect).toHaveBeenCalledWith(expect.any(File));
    expect(uploadChatFile).not.toHaveBeenCalled();
  });

  it("clears and restores staged attachments for send retries", async () => {
    uploadChatFile.mockResolvedValue(uploaded());
    const { result } = renderHook(() => useComposerAttachments(KEY));
    act(() => {
      result.current.addFiles([textFile()]);
    });
    await waitFor(() =>
      expect(result.current.attachments[0]?.status).toBe("ready"),
    );
    const staged = result.current.attachments;

    act(() => {
      result.current.clearAttachments(KEY);
    });
    expect(result.current.attachments).toHaveLength(0);

    act(() => {
      result.current.restoreAttachments(KEY, staged);
    });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]?.status).toBe("ready");
  });
});
