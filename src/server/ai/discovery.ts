import "server-only";

import { z } from "zod";

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

function providerStatusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Provider rejected the credentials";
  }
  if (status === 404) {
    return "Provider does not support model discovery";
  }
  return `Provider returned HTTP ${status}`;
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
      throw new AppError("PROVIDER_ERROR", 502, "Provider request timed out");
    }
    throw new AppError("PROVIDER_ERROR", 502, "Unable to reach the provider");
  }

  if (!response.ok) {
    if (response.body) {
      await response.body.cancel();
    }
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      providerStatusMessage(response.status),
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      "Provider returned an unexpected response",
    );
  }

  const result = servedModelsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      "PROVIDER_ERROR",
      502,
      "Provider returned an unexpected response",
    );
  }

  return result.data.data.map((model) => model.id);
}
