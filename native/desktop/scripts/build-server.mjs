import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopDir));
const outDir = join(desktopDir, "server");
const standaloneDir = join(repoRoot, ".next", "standalone");
const sourceNm = join(standaloneDir, "node_modules");
const storeDir = join(sourceNm, ".pnpm");
const destNm = join(outDir, "node_modules");

if (!existsSync(join(standaloneDir, "server.js"))) {
  throw new Error(`Standalone build not found at ${standaloneDir}; run DOCKER_BUILD=1 pnpm build first.`);
}

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

// Windows Defender and Next.js's copied symlinks can raise transient EPERM/EBUSY on fs calls.
function retryFs(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      const transient = process.platform === "win32" && (err?.code === "EPERM" || err?.code === "EBUSY");
      if (!transient || attempt >= 5) throw err;
      Atomics.wait(sleepBuffer, 0, 0, 50 * (attempt + 1));
    }
  }
}

// Next.js standalone on Windows can copy pnpm links as symlinks whose `stat()` fails with EPERM
// inside `realpathSync`; unwrap leaf links via `readlinkSync` before canonicalizing.
function resolveReal(targetPath) {
  let current = resolve(targetPath);
  const seen = new Set();
  while (retryFs(() => lstatSync(current)).isSymbolicLink()) {
    if (seen.has(current)) throw new Error(`Circular symlink encountered while resolving ${targetPath}`);
    seen.add(current);
    current = resolve(dirname(current), retryFs(() => readlinkSync(current)));
  }
  return retryFs(() => realpathSync(current));
}

// fs.cpSync's `dereference` does not follow symlinks nested inside a copied directory, and the
// standalone tree has some (`.next/node_modules/<pkg>-<hash>` aliases into `.pnpm`).
function copy(from, to) {
  const real = resolveReal(from);
  if (!retryFs(() => statSync(real)).isDirectory()) {
    retryFs(() => copyFileSync(real, to));
    return;
  }
  mkdirSync(to, { recursive: true });
  for (const entry of retryFs(() => readdirSync(real))) copy(join(real, entry), join(to, entry));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Next copies the developer's `.env*` into standalone; it must never ship in an installer.
for (const entry of readdirSync(standaloneDir)) {
  if (entry !== "node_modules" && !entry.startsWith(".env")) copy(join(standaloneDir, entry), join(outDir, entry));
}

// pnpm's layout is symlinks into `.pnpm`, which electron-builder's extraResources and Windows installers
// do not keep. Flatten it: every package something links to goes to the top level once, and a dependency
// whose version differs from the hoisted one is nested under the package that needs it. A package
// nothing links to is only loaded through a Turbopack alias (`.next/node_modules/<pkg>-<hash>`, copied
// whole above), so it is not hoisted a second time and its conflicting dependencies nest under the alias.
const packagesIn = (nm) =>
  retryFs(() => readdirSync(nm)).flatMap((name) =>
    name.startsWith(".") ? [] : name.startsWith("@") ? retryFs(() => readdirSync(join(nm, name))).map((sub) => `${name}/${sub}`) : [name],
  );
const storeEntries = readdirSync(storeDir)
  .filter((entry) => entry !== "node_modules")
  .map((entry) => join(storeDir, entry, "node_modules"))
  .filter((nm) => existsSync(nm));

const isLink = (nm, name) => retryFs(() => lstatSync(join(nm, name))).isSymbolicLink();
const aliasNm = join(standaloneDir, ".next", "node_modules");
const aliases = new Map(
  packagesIn(aliasNm).map((alias) => [resolveReal(join(aliasNm, alias)), join(outDir, ".next", "node_modules", alias)]),
);

const hoisted = new Map();
// Top-level links first (what server.js resolves), then pnpm's own hoisting choice, then everything else.
for (const nm of [sourceNm, join(storeDir, "node_modules"), ...storeEntries]) {
  if (!existsSync(nm)) continue;
  for (const name of packagesIn(nm)) {
    if (hoisted.has(name) || !isLink(nm, name)) continue;
    const real = resolveReal(join(nm, name));
    hoisted.set(name, real);
    copy(real, join(destNm, name));
  }
}

for (const nm of storeEntries) {
  const names = packagesIn(nm);
  const owners = names.filter((name) => !isLink(nm, name));
  for (const name of names.filter((name) => isLink(nm, name))) {
    const real = resolveReal(join(nm, name));
    if (hoisted.get(name) === real) continue;
    for (const owner of owners) {
      const ownerReal = resolveReal(join(nm, owner));
      const ownerDir = hoisted.get(owner) === ownerReal ? join(destNm, owner) : aliases.get(ownerReal);
      if (!ownerDir) {
        throw new Error(`Cannot place ${name} for ${owner}: ${owner} itself conflicts with the hoisted version.`);
      }
      copy(real, join(ownerDir, "node_modules", name));
    }
  }
}

// A real top-level directory is a partial trace (outputFileTracingIncludes): merge it over the full package.
for (const name of packagesIn(sourceNm).filter((name) => !isLink(sourceNm, name))) {
  copy(join(sourceNm, name), join(destNm, name));
}

copy(join(repoRoot, ".next", "static"), join(outDir, ".next", "static"));
copy(join(repoRoot, "public"), join(outDir, "public"));
copy(join(repoRoot, "src", "server", "db", "migrations"), join(outDir, "src", "server", "db", "migrations"));

const desktopRequire = createRequire(join(desktopDir, "package.json"));
const electronBin = desktopRequire("electron");

// better-sqlite3 is an N-API addon whose bundled prebuilds load in Electron as-is, so nothing is rebuilt; the smoke
// check below proves every bundled copy (hoisted package and/or Turbopack alias
// `.next/node_modules/better-sqlite3-<hash>`) loads under this Electron before the installer is built.
const outAliasNm = join(outDir, ".next", "node_modules");
const targetDirs = [
  ...[join(destNm, "better-sqlite3")].filter((dir) => existsSync(dir)),
  ...(existsSync(outAliasNm) ? readdirSync(outAliasNm) : [])
    .filter((entry) => entry === "better-sqlite3" || entry.startsWith("better-sqlite3-"))
    .map((entry) => join(outAliasNm, entry)),
];
if (targetDirs.length === 0) {
  throw new Error(`No better-sqlite3 package found inside ${outDir}; standalone trace may be broken.`);
}

const smokeScript = `
if (!process.versions.electron) throw new Error("Expected Electron runtime");
const paths = JSON.parse(process.argv[1]);
for (const modPath of paths) {
  const Database = require(modPath);
  const db = new Database(":memory:");
  const row = db.prepare("select sqlite_version() as v").get();
  if (!row || !row.v) throw new Error("SQLite smoke query failed");
  db.close();
}
console.log("Electron SQLite ABI smoke check passed:", paths.length, "module(s), Electron", process.versions.electron);
`;

execFileSync(electronBin, ["-e", smokeScript, JSON.stringify(targetDirs)], {
  cwd: outDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});
