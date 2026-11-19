import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const rootPkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2023" },
  define: { __APP_VERSION__: JSON.stringify(rootPkg.version) },
});
