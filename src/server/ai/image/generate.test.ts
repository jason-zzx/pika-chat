import { APICallError } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import type { ProviderApiFormat } from "@/lib/provider-format";
import type { ProviderEndpoint } from "@/server/ai/provider-factory";
import { AppError } from "@/server/errors";

import { generateImageForEndpoint } from "./generate";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function endpoint(
  apiFormat: ProviderApiFormat,
  overrides?: Partial<ProviderEndpoint>,
): ProviderEndpoint {
  return {
    apiFormat,
    name: "test",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-secret",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

describe("generateImageForEndpoint", () => {
  describe("openai-compatible", () => {
    it("posts the images/generations payload and decodes b64_json", async () => {
      globalThis.fetch = async (input, init) => {
        expect(String(input)).toBe(
          "https://api.example.com/v1/images/generations",
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-secret");
        expect(JSON.parse(String(init?.body))).toEqual({
          model: "gpt-image-1.5",
          prompt: "a cat",
          n: 2,
          response_format: "b64_json",
          size: "1024x1024",
          quality: "high",
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return jsonResponse({ data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }] });
      };

      const result = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1.5",
        { prompt: "a cat", size: "1024x1024", n: 2, quality: "high" },
      );
      expect(result.images).toHaveLength(2);
      expect(result.images[0]?.mediaType).toBe("image/png");
      expect(result.images[0]?.bytes).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(result.text).toBeUndefined();
    });

    it("omits Authorization when the endpoint has no key", async () => {
      globalThis.fetch = async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return jsonResponse({ data: [{ b64_json: PNG_B64 }] });
      };

      await generateImageForEndpoint(
        endpoint("openai-compatible", { apiKey: "" }),
        "local-image",
        { prompt: "a cat", n: 1 },
      );
    });

    it("downloads url responses server-side, using the content type", async () => {
      const calls: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/images/generations")) {
          return jsonResponse({ data: [{ url: "https://cdn.example.com/img.webp" }] });
        }
        return new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      };

      const result = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "seedream-4-5",
        { prompt: "a cat", size: "2048x2048", n: 1 },
      );
      expect(calls).toEqual([
        "https://api.example.com/v1/images/generations",
        "https://cdn.example.com/img.webp",
      ]);
      expect(result.images[0]?.mediaType).toBe("image/webp");
      expect(result.images[0]?.bytes).toEqual(Buffer.from([1, 2, 3]));
    });

    it("sniffs the media type of b64 payloads from their magic bytes", async () => {
      const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString(
        "base64",
      );
      const webpB64 = Buffer.from("RIFF\0\0\0\0WEBP", "ascii").toString("base64");
      const mysteryB64 = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
      const seen: string[] = [];
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { prompt: string };
        seen.push(body.prompt);
        const b64 =
          body.prompt === "jpeg"
            ? jpegB64
            : body.prompt === "webp"
              ? webpB64
              : mysteryB64;
        return jsonResponse({ data: [{ b64_json: b64 }] });
      };

      const jpeg = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "jpeg", n: 1 },
      );
      const webp = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "webp", n: 1 },
      );
      const unknown = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "unknown", n: 1 },
      );
      expect(seen).toEqual(["jpeg", "webp", "unknown"]);
      expect(jpeg.images[0]?.mediaType).toBe("image/jpeg");
      expect(webp.images[0]?.mediaType).toBe("image/webp");
      expect(unknown.images[0]?.mediaType).toBe("image/png");
    });

    it("tolerates explicit nulls from gateways", async () => {
      globalThis.fetch = async () =>
        jsonResponse({ data: [{ b64_json: PNG_B64, url: null }] });

      const result = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "a cat", n: 1 },
      );
      expect(result.images).toHaveLength(1);
    });
  });

  describe("google", () => {
    it("posts generateContent with imageConfig and parses inlineData + text", async () => {
      globalThis.fetch = async (input, init) => {
        expect(String(input)).toBe(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("x-goog-api-key")).toBe("sk-secret");
        expect(JSON.parse(String(init?.body))).toEqual({
          contents: [{ role: "user", parts: [{ text: "a cat" }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
          },
        });
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Here is your cat." },
                  { inlineData: { data: PNG_B64, mimeType: "image/png" } },
                ],
              },
            },
          ],
        });
      };

      const result = await generateImageForEndpoint(
        endpoint("google", {
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        }),
        "gemini-2.5-flash-image",
        { prompt: "a cat", size: "16:9", n: 1, imageSize: "2K" },
      );
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.mediaType).toBe("image/png");
      expect(result.text).toBe("Here is your cat.");
    });

    it("skips thought parts when collecting accompanying text", async () => {
      globalThis.fetch = async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "let me think about cats", thought: true },
                  { text: "Here is your cat." },
                  { inlineData: { data: PNG_B64, mimeType: "image/png" } },
                ],
              },
            },
          ],
        });

      const result = await generateImageForEndpoint(
        endpoint("google"),
        "gemini-2.5-flash-image",
        { prompt: "a cat", n: 1 },
      );
      expect(result.images).toHaveLength(1);
      expect(result.text).toBe("Here is your cat.");
    });

    it("fans n out into parallel generateContent calls and merges results", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse({
          candidates: [
            { content: { parts: [{ inlineData: { data: PNG_B64, mimeType: null } }] } },
          ],
        });
      };

      const result = await generateImageForEndpoint(
        endpoint("google"),
        "gemini-2.5-flash-image",
        { prompt: "a cat", n: 3 },
      );
      expect(calls).toBe(3);
      expect(result.images).toHaveLength(3);
    });

    it("omits imageConfig for non-aspect-ratio models", async () => {
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          generationConfig: Record<string, unknown>;
        };
        expect(body.generationConfig).toEqual({
          responseModalities: ["TEXT", "IMAGE"],
        });
        return jsonResponse({
          candidates: [
            { content: { parts: [{ inlineData: { data: PNG_B64, mimeType: "image/jpeg" } }] } },
          ],
        });
      };

      const result = await generateImageForEndpoint(
        endpoint("google"),
        "unknown-image-model",
        { prompt: "a cat", size: "1024x1024", n: 1 },
      );
      expect(result.images[0]?.mediaType).toBe("image/jpeg");
    });
  });

  describe("failure mapping", () => {
    it("throws APICallError with status and body so describeProviderError can lift the upstream error", async () => {
      globalThis.fetch = async () =>
        jsonResponse(
          { error: { message: "Invalid size. Supported: 1024x1024, 2048x2048" } },
          400,
        );

      const error = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "a cat", size: "999x999", n: 1 },
      ).catch((failure: unknown) => failure);

      expect(APICallError.isInstance(error)).toBe(true);
      if (APICallError.isInstance(error)) {
        expect(error.statusCode).toBe(400);
        expect(error.responseBody).toContain("Supported: 1024x1024");
      }
    });

    it("maps credential rejection to an APICallError status", async () => {
      globalThis.fetch = async () =>
        jsonResponse({ error: { message: "invalid key" } }, 401);

      const error = await generateImageForEndpoint(
        endpoint("openai-compatible"),
        "gpt-image-1",
        { prompt: "a cat", n: 1 },
      ).catch((failure: unknown) => failure);

      expect(APICallError.isInstance(error)).toBe(true);
      if (APICallError.isInstance(error)) {
        expect(error.statusCode).toBe(401);
      }
    });

    it("propagates abort/timeout errors untouched for describeProviderError", async () => {
      const timeout = new Error("The operation timed out");
      timeout.name = "TimeoutError";
      globalThis.fetch = async () => {
        throw timeout;
      };

      await expect(
        generateImageForEndpoint(endpoint("google"), "gemini-2.5-flash-image", {
          prompt: "a cat",
          n: 1,
        }),
      ).rejects.toBe(timeout);
    });

    it("rejects a malformed success body as an unexpected response", async () => {
      globalThis.fetch = async () => jsonResponse({ data: [] });

      await expect(
        generateImageForEndpoint(
          endpoint("openai-compatible"),
          "gpt-image-1",
          { prompt: "a cat", n: 1 },
        ),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        messageKey: "provider.unexpectedResponse",
      });
    });

    it("rejects google responses without any image part", async () => {
      globalThis.fetch = async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "I cannot draw that." }] } }],
        });

      await expect(
        generateImageForEndpoint(endpoint("google"), "gemini-2.5-flash-image", {
          prompt: "a cat",
          n: 1,
        }),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        messageKey: "provider.unexpectedResponse",
      });
    });
  });

  describe("claude", () => {
    it("has no image adapter", async () => {
      await expect(
        generateImageForEndpoint(endpoint("claude"), "claude-sonnet-4-5", {
          prompt: "a cat",
          n: 1,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof AppError &&
          error.code === "VALIDATION_FAILED" &&
          error.status === 400 &&
          error.messageKey === "model.imageUnsupported",
      );
    });
  });
});
