<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

---

# Project Guidelines

## Changelog & Release Notes Convention

Whenever preparing a release or documenting notable changes, adhere to the following standards:

1. **Bilingual Changelogs**:
   - `CHANGELOG.md`: Primary English version.
   - `CHANGELOG.zh-CN.md`: Simplified Chinese version.
   Both files must be updated together when publishing new versions.

2. **Automated Release Notes Integration**:
   - The release workflow (`.github/workflows/release.yml`) uses `scripts/extract-changelog.mjs` to extract the corresponding version's notes from `CHANGELOG.md` and uses them directly as the GitHub Release body.
   - Version headings must follow the format `## [X.Y.Z] - YYYY-MM-DD` (or `## X.Y.Z - YYYY-MM-DD`).

3. **Standard Section Structure**:
   - Under each version heading, use only the following permitted level-3 section headings:
     - `Highlights`
     - `Feats`
     - `Fixes`
     - `Dev`
     - `Chore`
   - Include only the sections that contain actual additions or modifications in the release (omit empty sections).

4. **No Routine Database Migrations**:
   - Do not mention routine Drizzle migration commits in changelogs — they are normal daily development, not user-facing changes. Only document them if the migration itself requires operator action (e.g. manual data backfill or breaking schema change).

## Behavior

Bias toward action. Infer intent from context and keep moving until the task is complete.
Execute reversible actions, read-only operations, and contextually authorized steps directly.
Do not proactively add warnings, disclaimers, or safety checklists for hypothetical risks.
When uncertain, state your assumption and proceed; ask questions only before destructive actions or when critical information is genuinely missing.

## Code

- Validate unknown values once at the boundary that owns them. Pass typed values inward instead of repeating runtime type checks and property-existence checks. Do not defensively revalidate values already guaranteed by a schema, constructor, or internal type.
- Avoid `try` / `catch` where possible; use them only at boundaries where failure is expected and must be handled locally.
- Do not add validation, fallbacks, retries, or null guards for speculative failures.
- Keep things in one function unless composable or reusable. Do not extract single-use helpers preemptively; inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or makes the main function read as a clean happy path.
- Do not return async or result/effect wrappers from helpers unless they actually perform async or fallible work. Synchronous parsing, validation, and option building should stay synchronous.
- Reduce total variable count by inlining when a value is only used once. Avoid unnecessary destructuring; use dot notation (`obj.a`) to preserve context.
- Keep control flow flat: avoid `else` statements and prefer early returns. Prefer `const` over `let`; use ternaries or early returns instead of reassignment.
- Avoid using the `any` type (or dynamic escape hatches). Rely on type inference when possible; avoid explicit type annotations unless necessary for exports or clarity.
- Implement the simplest solution for the current requirement; do not pre-build abstractions, compatibility layers, or extension points for hypothetical future needs.
- Do not write unrequested tests, files, or comments for obvious assignments and control flow; add comments only for non-obvious constraints and surprising behavior. When testing, avoid mocks as much as possible and test the actual implementation.
- Execute small changes directly. Before adding complexity for a larger change, a speculative race, or an edge case, output a brief plan (files affected, approximate lines, and complexity cost) and get buy-in before writing code.

## Hard Constraints

- Validate once at the system entry boundary and trust internal types inward.
- Never add defensive revalidation, redundant null/undefined checks, or preemptive `try` / `catch` blocks.
- Never extract helpers, add abstraction layers, or write compatibility shims "just in case".
- Stop immediately once the current task is complete. Do not silently expand scope or reformat unrelated code.
