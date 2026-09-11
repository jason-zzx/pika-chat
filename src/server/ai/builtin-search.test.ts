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

function parsedBody(call: RecordedCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
}

describe("withBuiltinWebSearch", () => {
  describe("openai-compatible", () => {
    it("injects web_search_options into chat-completions POST bodies", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);

      await wrapped("https://api.example.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [], stream: true }),
      });

      expect(parsedBody(calls[0])).toEqual({
        model: "gpt-4o",
        messages: [],
        stream: true,
        web_search_options: {},
      });
    });
  });

  describe("claude", () => {
    it("appends the web search server tool to messages POST bodies", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("claude", base);

      await wrapped("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-sonnet-4-5", messages: [] }),
      });

      expect(parsedBody(calls[0])).toEqual({
        model: "claude-sonnet-4-5",
        messages: [],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ],
      });
    });

    it("keeps function tools the caller already registered", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("claude", base);
      const existingTool = { name: "searchWeb", input_schema: {} };

      await wrapped("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-sonnet-4-5", tools: [existingTool] }),
      });

      expect(parsedBody(calls[0])?.tools).toEqual([
        existingTool,
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ]);
    });

    it("leaves the token-counting endpoint untouched", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("claude", base);
      const original = JSON.stringify({ model: "claude-sonnet-4-5" });

      await wrapped("https://api.anthropic.com/v1/messages/count_tokens", {
        method: "POST",
        body: original,
      });

      expect(calls[0]?.init?.body).toBe(original);
    });
  });

  describe("google", () => {
    it.each([":generateContent", ":streamGenerateContent"])(
      "appends the googleSearch grounding tool to %s bodies",
      async (method) => {
        const { calls, base } = recordingFetch();
        const wrapped = withBuiltinWebSearch("google", base);

        await wrapped(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash${method}`,
          {
            method: "POST",
            body: JSON.stringify({ contents: [], generationConfig: {} }),
          },
        );

        expect(parsedBody(calls[0])).toEqual({
          contents: [],
          generationConfig: {},
          tools: [{ googleSearch: {} }],
        });
      },
    );

    it("keeps the function declarations the caller already registered", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("google", base);

      await wrapped(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          body: JSON.stringify({ tools: [{ functionDeclarations: [] }] }),
        },
      );

      expect(parsedBody(calls[0])?.tools).toEqual([
        { functionDeclarations: [] },
        { googleSearch: {} },
      ]);
    });
  });

  describe("shared pass-through rules", () => {
    it("leaves requests to other paths untouched", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);
      const original = JSON.stringify({ model: "gpt-4o" });

      await wrapped("https://api.example.com/v1/models", {
        method: "POST",
        body: original,
      });

      expect(calls[0]?.init?.body).toBe(original);
    });

    it("does not inject across formats", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);
      const original = JSON.stringify({ contents: [] });

      await wrapped(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
        { method: "POST", body: original },
      );

      expect(calls[0]?.init?.body).toBe(original);
    });

    it("leaves non-POST requests untouched", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);

      await wrapped("https://api.example.com/v1/chat/completions");

      expect(calls[0]?.init?.body).toBeUndefined();
    });

    it("passes through a non-string body unchanged", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);
      const body = new Blob(["x"]);

      await wrapped("https://api.example.com/v1/chat/completions", {
        method: "POST",
        body,
      });

      expect(calls[0]?.init?.body).toBe(body);
    });

    it("passes through an unparseable body unchanged", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("openai-compatible", base);

      await wrapped("https://api.example.com/v1/chat/completions", {
        method: "POST",
        body: "not json",
      });

      expect(calls[0]?.init?.body).toBe("not json");
    });

    it("passes through a JSON array body unchanged", async () => {
      const { calls, base } = recordingFetch();
      const wrapped = withBuiltinWebSearch("google", base);
      const original = JSON.stringify([{ contents: [] }]);

      await wrapped(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        { method: "POST", body: original },
      );

      expect(calls[0]?.init?.body).toBe(original);
    });

    it("forwards the inner response", async () => {
      const base = vi.fn(
        () => Promise.resolve(new Response("ok", { status: 201 })),
      ) as unknown as typeof fetch;
      const wrapped = withBuiltinWebSearch("openai-compatible", base);

      const response = await wrapped(
        "https://api.example.com/v1/chat/completions",
        { method: "POST", body: JSON.stringify({ messages: [] }) },
      );

      expect(response.status).toBe(201);
    });
  });
});
