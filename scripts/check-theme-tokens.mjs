#!/usr/bin/env node
/**
 * Verifies that every theme preset block in src/app/globals.css declares the
 * full baseline token set: [data-theme="X"] must cover every custom property
 * defined in :root (radius tokens excepted — they are not redefined per
 * theme) and [data-theme="X"].dark must cover every one in .dark.
 *
 * Dependency-free text parsing on purpose. Exits non-zero and lists the
 * missing tokens when any preset block is incomplete or absent.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(repoRoot, "src/app/globals.css"), "utf8");

// Same-source the preset list from src/lib/theme.ts so the two cannot drift.
const themeSource = readFileSync(join(repoRoot, "src/lib/theme.ts"), "utf8");
const presetMatch = themeSource.match(/THEME_PRESETS\s*=\s*\[([\s\S]*?)\]/);
if (!presetMatch) {
  console.error(
    "check-theme-tokens failed: could not find THEME_PRESETS in src/lib/theme.ts",
  );
  process.exit(1);
}
const PRESETS = [...presetMatch[1].matchAll(/"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((preset) => preset !== "default");

/**
 * Collects top-level selector blocks and the custom properties each declares.
 * Only blocks opened at brace depth 0 are recorded; nested rules (e.g.
 * @keyframes inside @theme) are skipped by the depth tracking.
 */
function extractBlocks(source) {
  const blocks = new Map();
  let depth = 0;
  let current = null;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (depth === 0 && trimmed.endsWith("{")) {
      current = trimmed.slice(0, -1).trim();
      depth = 1;
      if (!blocks.has(current)) {
        blocks.set(current, new Set());
      }
      continue;
    }
    if (current === null) {
      continue;
    }
    for (const match of line.matchAll(/(--[\w-]+)\s*:/g)) {
      blocks.get(current).add(match[1]);
    }
    for (const char of line) {
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (depth === 0) {
      current = null;
    }
  }
  return blocks;
}

const blocks = extractBlocks(css);

const problems = [];

function baseline(selector) {
  const tokens = blocks.get(selector);
  if (!tokens || tokens.size === 0) {
    problems.push(`baseline block \`${selector}\` not found in globals.css`);
    return [];
  }
  return [...tokens];
}

// --radius is shared across presets, so preset blocks do not redefine it.
const lightBaseline = baseline(":root").filter(
  (token) => !token.startsWith("--radius"),
);
const darkBaseline = baseline(".dark");

function checkPresetBlock(selector, baselineTokens) {
  const tokens = blocks.get(selector);
  if (!tokens) {
    problems.push(`preset block \`${selector}\` is missing entirely`);
    return;
  }
  const missing = baselineTokens.filter((token) => !tokens.has(token));
  if (missing.length > 0) {
    problems.push(
      `preset block \`${selector}\` is missing ${missing.length} token(s): ${missing.join(", ")}`,
    );
  }
}

for (const preset of PRESETS) {
  checkPresetBlock(`[data-theme='${preset}']`, lightBaseline);
  checkPresetBlock(`[data-theme='${preset}'].dark`, darkBaseline);
}

if (problems.length > 0) {
  console.error("check-theme-tokens failed:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `check-theme-tokens OK: ${PRESETS.length} presets cover ${lightBaseline.length} light + ${darkBaseline.length} dark baseline tokens`,
);
