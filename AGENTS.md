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

