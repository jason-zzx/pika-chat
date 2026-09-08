import { describe, expect, it, vi } from "vitest";

import { withBuiltinWebSearch } from "@/server/ai/builtin-search";

type RecordedCall = { url: string; init?: RequestInit };

function recordingFetch(): { calls: RecordedCall[]; base: typeof fetch } {
  const calls: RecordedCall[] = [];
  const base = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      init,
    });
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  return { calls, base };
}

describe("withBuiltinWebSearch", () => {
  it("injects web_search_options into chat-completions POST bodies", async () => {
    const { calls, base } = recordingFetch();
    const wrapped = withBuiltinWebSearch(base);

    await wrapped("https://api.example.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [], stream: true }),
    });

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      model: "gpt-4o",
      messages: [],
      stream: true,
      web_search_options: {},
    });
  });

  it("leaves requests to other paths untouched", async () => {
    const { calls, base } = recordingFetch();
    const wrapped = withBuiltinWebSearch(base);
    const original = JSON.stringify({ model: "gpt-4o" });

    await wrapped("https://api.example.com/v1/models", {
      method: "POST",
      body: original,
    });

    expect(calls[0]?.init?.body).toBe(original);
  });

  it("leaves non-POST requests untouched", async () => {
    const { calls, base } = recordingFetch();
    const wrapped = withBuiltinWebSearch(base);

    await wrapped("https://api.example.com/v1/chat/completions");

    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("passes through a non-string body unchanged", async () => {
    const { calls, base } = recordingFetch();
    const wrapped = withBuiltinWebSearch(base);
    const body = new Blob(["x"]);

    await wrapped("https://api.example.com/v1/chat/completions", {
      method: "POST",
      body,
    });

    expect(calls[0]?.init?.body).toBe(body);
  });

  it("passes through an unparseable body unchanged", async () => {
    const { calls, base } = recordingFetch();
    const wrapped = withBuiltinWebSearch(base);

    await wrapped("https://api.example.com/v1/chat/completions", {
      method: "POST",
      body: "not json",
    });

    expect(calls[0]?.init?.body).toBe("not json");
  });

  it("forwards the inner response", async () => {
    const base = vi.fn(
      () => Promise.resolve(new Response("ok", { status: 201 })),
    ) as unknown as typeof fetch;
    const wrapped = withBuiltinWebSearch(base);

    const response = await wrapped(
      "https://api.example.com/v1/chat/completions",
      { method: "POST", body: JSON.stringify({ messages: [] }) },
    );

    expect(response.status).toBe(201);
  });
});
