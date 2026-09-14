import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": resolve(root, "src"),
  "@test": resolve(root, "test"),
  "server-only": resolve(root, "test/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit-node",
          environment: "node",
          include: [
            "src/server/**/*.test.ts",
            "src/lib/**/*.test.ts",
            "src/components/**/*.test.ts",
            "src/app/**/*.test.ts",
            "src/i18n/**/*.test.ts",
            "src/stores/**/*.test.ts",
          ],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx", "src/hooks/**/*.test.ts"],
          setupFiles: ["./vitest.dom.setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          globalSetup: "./vitest.integration.setup.ts",
          setupFiles: [
            "./vitest.integration.env.ts",
            "./vitest.integration.storage.ts",
          ],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
