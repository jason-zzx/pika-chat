import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

// fs.cpSync's `dereference` does not follow symlinks nested inside a copied directory, and the
// standalone tree has some (`.next/node_modules/<pkg>-<hash>` aliases into `.pnpm`).
function copy(from, to) {
  const real = realpathSync(from);
  if (!statSync(real).isDirectory()) {
    copyFileSync(real, to);
    return;
  }
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(real)) copy(join(real, entry), join(to, entry));
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
  readdirSync(nm).flatMap((name) =>
    name.startsWith(".") ? [] : name.startsWith("@") ? readdirSync(join(nm, name)).map((sub) => `${name}/${sub}`) : [name],
  );
const storeEntries = readdirSync(storeDir)
  .filter((entry) => entry !== "node_modules")
  .map((entry) => join(storeDir, entry, "node_modules"))
  .filter((nm) => existsSync(nm));

const isLink = (nm, name) => lstatSync(join(nm, name)).isSymbolicLink();
const aliasNm = join(standaloneDir, ".next", "node_modules");
const aliases = new Map(
  packagesIn(aliasNm).map((alias) => [realpathSync(join(aliasNm, alias)), join(outDir, ".next", "node_modules", alias)]),
);

const hoisted = new Map();
// Top-level links first (what server.js resolves), then pnpm's own hoisting choice, then everything else.
for (const nm of [sourceNm, join(storeDir, "node_modules"), ...storeEntries]) {
  if (!existsSync(nm)) continue;
  for (const name of packagesIn(nm)) {
    if (hoisted.has(name) || !isLink(nm, name)) continue;
    const real = realpathSync(join(nm, name));
    hoisted.set(name, real);
    copy(real, join(destNm, name));
  }
}

for (const nm of storeEntries) {
  const names = packagesIn(nm);
  const owners = names.filter((name) => !isLink(nm, name));
  for (const name of names.filter((name) => isLink(nm, name))) {
    const real = realpathSync(join(nm, name));
    if (hoisted.get(name) === real) continue;
    for (const owner of owners) {
      const ownerReal = realpathSync(join(nm, owner));
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
