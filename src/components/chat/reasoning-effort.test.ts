import { describe, expect, it } from "vitest";

import { reasoningEffortRequestValue } from "./reasoning-effort";

describe("reasoningEffortRequestValue", () => {
  const model = {
    reasoning: true,
    reasoningOptions: ["low", "medium", "high"],
  };

  it("omits Auto", () => {
    expect(reasoningEffortRequestValue(model, null)).toBeUndefined();
  });

  it("sends a stored option", () => {
    expect(reasoningEffortRequestValue(model, "high")).toBe("high");
  });

  it("omits effort when the model does not reason", () => {
    expect(
      reasoningEffortRequestValue(
        { reasoning: false, reasoningOptions: ["high"] },
        "high",
      ),
    ).toBeUndefined();
  });
});
