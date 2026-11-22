import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const entryPoints = readdirSync(join(desktop, "src"))
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => join("src", name));

if (entryPoints.length === 0) {
  process.exit(0);
}

const outdir = mkdtempSync(join(tmpdir(), "pika-desktop-test-"));
try {
  await build({
    absWorkingDir: desktop,
    entryPoints,
    outdir,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outExtension: { ".js": ".cjs" },
  });
  const testFiles = readdirSync(outdir)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => join(outdir, name));
  const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
