import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  presignChatFile,
  uploadChatFileDirect,
  uploadToPresignedPost,
} from "./files";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const PRESIGNED = {
  fileId: "file-1",
  post: { url: "https://s3.test/bucket", fields: { key: "user/file-1", policy: "p" } },
};

const UPLOADED = {
  id: "file-1",
  url: "/api/files/file-1",
  filename: "notes.txt",
  mediaType: "text/plain",
  sizeBytes: 5,
  extraction: { status: "ok", truncated: false },
};

describe("presigned upload helpers", () => {
  it("requests a policy with the file's declared name and type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(PRESIGNED), { status: 201 }),
    );

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(presignChatFile(file)).resolves.toEqual(PRESIGNED);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/files/presign");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      filename: "notes.txt",
      mediaType: "text/plain",
    });
  });

  it("posts the policy fields and the file last", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await uploadToPresignedPost(
      PRESIGNED.post,
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://s3.test/bucket");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("key")).toBe("user/file-1");
    expect(form.get("policy")).toBe("p");
    expect((form.get("file") as File).name).toBe("notes.txt");
  });

  it("throws when storage rejects the upload", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(
      uploadToPresignedPost(
        PRESIGNED.post,
        new File(["x"], "notes.txt", { type: "text/plain" }),
      ),
    ).rejects.toThrow(/403/);
  });

  it("runs presign → storage → complete in order", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(PRESIGNED), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(UPLOADED), { status: 200 }),
      );

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(uploadChatFileDirect(file)).resolves.toEqual(UPLOADED);

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "/api/files/presign",
      "https://s3.test/bucket",
      "/api/files/complete",
    ]);
    expect(JSON.parse(calls[2]?.[1].body as string)).toEqual({
      fileId: "file-1",
    });
  });
});
