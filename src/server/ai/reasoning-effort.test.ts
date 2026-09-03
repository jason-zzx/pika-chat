import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { resolvedReasoningEffort } from "./reasoning-effort";

describe("resolvedReasoningEffort", () => {
  const reasoningModel = {
    reasoning: true,
    reasoningOptions: ["low", "medium", "high"],
  };

  it("omits Auto / missing effort", () => {
    expect(resolvedReasoningEffort(reasoningModel, undefined)).toBeUndefined();
  });

  it("accepts a stored option", () => {
    expect(resolvedReasoningEffort(reasoningModel, "high")).toBe("high");
  });

  it("rejects an effort the model does not list", () => {
    try {
      resolvedReasoningEffort(reasoningModel, "xhigh");
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
      });
    }
  });

  it("rejects effort when the model does not reason", () => {
    try {
      resolvedReasoningEffort(
        { reasoning: false, reasoningOptions: [] },
        "high",
      );
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});
