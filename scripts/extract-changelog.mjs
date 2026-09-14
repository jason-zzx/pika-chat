import fs from "node:fs";

/**
 * Extracts the release notes for a given version tag from CHANGELOG.md.
 * Usage: node scripts/extract-changelog.mjs <tag> [changelog_file]
 * Example: node scripts/extract-changelog.mjs v0.1.0
 */

const tag = process.argv[2] || "";
const file = process.argv[3] || "CHANGELOG.md";

if (!tag) {
  console.error("Error: Tag argument is required (e.g. v0.1.0 or 0.1.0)");
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`Error: File ${file} not found`);
  process.exit(1);
}

const version = tag.replace(/^v/, "");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const content = fs.readFileSync(file, "utf8");
const lines = content.split(/\r?\n/);

// Matches:
// ## [0.1.0] - 2026-09-14
// ## 0.1.0 - 2026-09-14
// ## [v0.1.0]
// ## 0.1.0
const headerPrefixRegex = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`);

let capturing = false;
const capturedLines = [];

for (const line of lines) {
  if (headerPrefixRegex.test(line)) {
    capturing = true;
    continue;
  }
  if (capturing) {
    // Stop at the next level-2 heading (e.g. ## [0.0.9])
    if (/^##\s+/.test(line)) {
      break;
    }
    capturedLines.push(line);
  }
}

const result = capturedLines.join("\n").trim();

if (result) {
  process.stdout.write(result + "\n");
} else {
  console.error(`Warning: Version ${version} not found in ${file}`);
  process.exit(1);
}
