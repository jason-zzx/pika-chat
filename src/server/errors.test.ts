import "server-only";

import { describe, expect, it } from "vitest";

import { AppError } from "./errors";

describe("AppError", () => {
  it("exposes a stable code and HTTP status", () => {
    const error = new AppError("NOT_FOUND", 404, "Topic not found");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.message).toBe("Topic not found");
  });
});
