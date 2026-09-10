import "server-only";

import { describe, expect, it } from "vitest";

import { AppError } from "./errors";

describe("AppError", () => {
  it("exposes a stable code, HTTP status, and message key", () => {
    const error = new AppError("NOT_FOUND", 404, "topic.notFound");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.messageKey).toBe("topic.notFound");
    expect(error.message).toBe("topic.notFound");
  });

  it("carries ICU params and details for the client to resolve", () => {
    const error = new AppError(
      "VALIDATION_FAILED",
      400,
      "validation.failed",
      { status: 400 },
      { fieldErrors: { title: { key: "required" } } },
    );

    expect(error.params).toEqual({ status: 400 });
    expect(error.details).toEqual({
      fieldErrors: { title: { key: "required" } },
    });
  });
});
