import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { fetchServedModelIds } from "./discovery";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchServedModelIds", () => {
  it("returns served model ids", async () => {
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("https://api.example.com/v1/models");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-secret");
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "gpt-4o", object: "model" },
            { id: "gpt-4o-mini", object: "model" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(
      fetchServedModelIds("https://api.example.com/v1/", "sk-secret"),
    ).resolves.toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("omits Authorization when no key is provided", async () => {
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      return new Response(JSON.stringify({ data: [{ id: "llama3" }] }), {
        status: 200,
      });
    };

    await expect(
      fetchServedModelIds("http://127.0.0.1:11434/v1", null),
    ).resolves.toEqual(["llama3"]);
  });

  it("maps a 401 to PROVIDER_ERROR without echoing the upstream body", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "invalid api_key sk-leaked" }), {
        status: 401,
      });

    try {
      await fetchServedModelIds("https://api.example.com/v1", "sk-leaked");
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
      await fetchServedModelIds("https://api.example.com/v1", "sk-test");
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
      await fetchServedModelIds("https://api.example.com/v1", "sk-leaked");
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
      await fetchServedModelIds("https://api.example.com/v1", "sk-leaked");
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
