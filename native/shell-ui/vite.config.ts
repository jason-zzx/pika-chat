import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2023" },
  test: { include: ["src/**/*.test.ts"] },
});
