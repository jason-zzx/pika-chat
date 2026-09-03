import { describe, expect, it } from "vitest";

import { createAssistantSchema } from "./assistant";

describe("createAssistantSchema.icon", () => {
  it("accepts a string whose UTF-16 length is 11", () => {
    const icon = "👨‍👩‍👧‍👦";
    expect(icon.length).toBe(11);
    expect(createAssistantSchema.parse({ name: "Work", icon }).icon).toBe(icon);
  });

  it("accepts length 32 and rejects 33", () => {
    expect(
      createAssistantSchema.parse({ name: "Work", icon: "a".repeat(32) }).icon,
    ).toBe("a".repeat(32));
    expect(() =>
      createAssistantSchema.parse({ name: "Work", icon: "a".repeat(33) }),
    ).toThrow();
  });
});
