import { describe, expect, it, vi } from "vitest";

import pkg from "../../../package.json";

vi.mock("@/server/db/client", () => ({
  getDb: () => ({ get: () => ({ 1: 1 }) }),
}));

import { checkHealth } from "./health.service";

describe("checkHealth", () => {
  it("reports ok with the app version", async () => {
    expect(await checkHealth()).toEqual({ ok: true, version: pkg.version });
  });
});
