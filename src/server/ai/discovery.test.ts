import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { fetchServedModelIds } from "./discovery";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The pre-existing cases all target the OpenAI-compatible format. */
function discoverOpenAI(baseUrl: string, apiKey: string | null) {
  return fetchServedModelIds({ apiFormat: "openai-compatible", baseUrl, apiKey });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchServedModelIds", () => {
  describe("openai-compatible", () => {
    it("returns served model ids", async () => {
      globalThis.fetch = async (input, init) => {
        expect(String(input)).toBe("https://api.example.com/v1/models");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-secret");
        return jsonResponse({
          object: "list",
          data: [
            { id: "gpt-4o", object: "model" },
            { id: "gpt-4o-mini", object: "model" },
          ],
        });
      };

      await expect(
        discoverOpenAI("https://api.example.com/v1/", "sk-secret"),
      ).resolves.toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("omits Authorization when no key is provided", async () => {
      globalThis.fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBeNull();
        return jsonResponse({ data: [{ id: "llama3" }] });
      };

      await expect(
        discoverOpenAI("http://127.0.0.1:11434/v1", null),
      ).resolves.toEqual(["llama3"]);
    });
  });

  describe("claude", () => {
    it("authenticates with x-api-key and the protocol version header", async () => {
      globalThis.fetch = async (input, init) => {
        expect(String(input)).toBe("https://api.anthropic.com/v1/models");
        const headers = new Headers(init?.headers);
        expect(headers.get("x-api-key")).toBe("sk-ant-secret");
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
        expect(headers.get("authorization")).toBeNull();
        return jsonResponse({
          data: [{ id: "claude-sonnet-4-5" }, { id: "claude-opus-4-1" }],
        });
      };

      await expect(
        fetchServedModelIds({
          apiFormat: "claude",
          baseUrl: "https://api.anthropic.com/v1/",
          apiKey: "sk-ant-secret",
        }),
      ).resolves.toEqual(["claude-sonnet-4-5", "claude-opus-4-1"]);
    });
  });

  describe("google", () => {
    it("authenticates with x-goog-api-key and strips the models/ prefix", async () => {
      globalThis.fetch = async (input, init) => {
        expect(String(input)).toBe(
          "https://generativelanguage.googleapis.com/v1beta/models",
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("x-goog-api-key")).toBe("goog-secret");
        expect(headers.get("authorization")).toBeNull();
        return jsonResponse({
          models: [
            { name: "models/gemini-2.5-flash" },
            { name: "models/gemini-2.5-pro" },
          ],
        });
      };

      await expect(
        fetchServedModelIds({
          apiFormat: "google",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          apiKey: "goog-secret",
        }),
      ).resolves.toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    });

    it("drops models that cannot generate content", async () => {
      globalThis.fetch = async () =>
        jsonResponse({
          models: [
            {
              name: "models/gemini-2.5-flash",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/text-embedding-004",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        });

      await expect(
        fetchServedModelIds({
          apiFormat: "google",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          apiKey: "goog-secret",
        }),
      ).resolves.toEqual(["gemini-2.5-flash"]);
    });

    it("keeps models whose generation methods are unstated", async () => {
      globalThis.fetch = async () =>
        jsonResponse({ models: [{ name: "models/gemini-3-flash" }] });

      await expect(
        fetchServedModelIds({
          apiFormat: "google",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          apiKey: null,
        }),
      ).resolves.toEqual(["gemini-3-flash"]);
    });

    it("treats a null supportedGenerationMethods as unstated, not as a bad response", async () => {
      // Gemini-compatible gateways emit `null` for fields the upstream left
      // unset; rejecting them used to fail the whole listing.
      globalThis.fetch = async () =>
        jsonResponse({
          models: [
            {
              name: "minimax-m3",
              baseModelId: null,
              displayName: "minimax-m3",
              supportedGenerationMethods: null,
            },
          ],
        });

      await expect(
        fetchServedModelIds({
          apiFormat: "google",
          baseUrl: "http://192.168.99.224:3070/v1beta",
          apiKey: "gateway-key",
        }),
      ).resolves.toEqual(["minimax-m3"]);
    });

    it("rejects the OpenAI list shape", async () => {
      globalThis.fetch = async () =>
        jsonResponse({ data: [{ id: "gemini-2.5-flash" }] });

      await expect(
        fetchServedModelIds({
          apiFormat: "google",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          apiKey: "goog-secret",
        }),
      ).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
        status: 502,
        messageKey: "provider.unexpectedResponse",
      });
    });
  });

  describe("error mapping", () => {
    it("maps a 401 to PROVIDER_ERROR without echoing the upstream body", async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "invalid api_key sk-leaked" }), {
          status: 401,
        });

      try {
        await discoverOpenAI("https://api.example.com/v1", "sk-leaked");
        throw new Error("expected discovery to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          code: "PROVIDER_ERROR",
          status: 502,
          messageKey: "provider.credentialsRejected",
        });
        if (error instanceof Error) {
          expect(error.message).not.toContain("sk-leaked");
        }
      }
    });

    it("maps a timeout to PROVIDER_ERROR", async () => {
      globalThis.fetch = async () => {
        const error = new Error("The operation was aborted");
        error.name = "TimeoutError";
        throw error;
      };

      try {
        await discoverOpenAI("https://api.example.com/v1", "sk-test");
        throw new Error("expected discovery to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROVIDER_ERROR",
          status: 502,
          messageKey: "provider.timedOut",
        });
      }
    });

    it("reports other provider statuses as a key with the status param", async () => {
      globalThis.fetch = async () =>
        new Response("upstream exploded sk-leaked", { status: 503 });

      try {
        await discoverOpenAI("https://api.example.com/v1", "sk-leaked");
        throw new Error("expected discovery to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROVIDER_ERROR",
          status: 502,
          messageKey: "provider.httpStatus",
          params: { status: 503 },
        });
        if (error instanceof Error) {
          expect(error.message).not.toContain("sk-leaked");
        }
      }
    });

    it("maps a non-JSON body to PROVIDER_ERROR without echoing it", async () => {
      globalThis.fetch = async () =>
        new Response("<html>gateway sk-leaked</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });

      try {
        await discoverOpenAI("https://api.example.com/v1", "sk-leaked");
        throw new Error("expected discovery to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROVIDER_ERROR",
          status: 502,
          messageKey: "provider.unexpectedResponse",
        });
        if (error instanceof Error) {
          expect(error.message).not.toContain("sk-leaked");
          expect(error.message).not.toContain("<html>");
        }
      }
    });
  });
});
