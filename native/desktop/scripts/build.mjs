import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktop = new URL("../", import.meta.url);
const RUNTIME_ASSETS = ["icon.png", "tray.png", "trayTemplate.png", "trayTemplate@2x.png"];
const version = JSON.parse(readFileSync(new URL("../../package.json", desktop), "utf8")).version;

rmSync(new URL("dist", desktop), { recursive: true, force: true });

// Sandboxed preloads cannot load ESM, so everything is CommonJS.
await build({
  absWorkingDir: fileURLToPath(desktop),
  entryPoints: {
    main: "src/main.ts",
    "preload-shell": "src/preload-shell.ts",
    "preload-remote": "src/preload-remote.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "electron-updater"],
  define: { __APP_VERSION__: JSON.stringify(version) },
});

cpSync(new URL("../shell-ui/dist", desktop), new URL("dist/shell-ui", desktop), { recursive: true });
mkdirSync(new URL("dist/assets", desktop), { recursive: true });
for (const file of RUNTIME_ASSETS) {
  cpSync(new URL(`assets/${file}`, desktop), new URL(`dist/assets/${file}`, desktop));
}
