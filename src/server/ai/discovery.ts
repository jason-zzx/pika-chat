import "server-only";

import { z } from "zod";

import type { AppErrorMessageKey } from "@/lib/api/error-contract";
import { AppError } from "@/server/errors";

const servedModelsSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function providerStatusKey(status: number): AppErrorMessageKey {
  if (status === 401 || status === 403) {
    return "provider.credentialsRejected";
  }
  if (status === 404) {
    return "provider.discoveryUnsupported";
  }
  return "provider.httpStatus";
}

export async function fetchServedModelIds(
  baseUrl: string,
  apiKey: string | null,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers = new Headers();
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AppError("PROVIDER_ERROR", 502, "provider.timedOut");
    }
    throw new AppError("PROVIDER_ERROR", 502, "provider.unreachable");
  }

  if (!response.ok) {
    if (response.body) {
      await response.body.cancel();
    }
    const messageKey = providerStatusKey(response.status);
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      messageKey,
      messageKey === "provider.httpStatus" ? { status: response.status } : undefined,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      "provider.unexpectedResponse",
    );
  }

  const result = servedModelsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      "provider.unexpectedResponse",
    );
  }

  return result.data.data.map((model) => model.id);
}
