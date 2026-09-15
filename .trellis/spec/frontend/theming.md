# Theming

> Token system, preset themes, and the DB-backed theme preference pipeline.
> Landed in `09-15-theme-presets`.

---

## Token system

Tailwind 4 theme tokens are CSS custom properties in `src/app/globals.css`:
the `@theme inline` block maps Tailwind colors onto `--background`,
`--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--border`,
`--ring`, `--success`, `--chart-*`, `--sidebar-*`, etc. The baseline palettes
are the `:root` (light) and `.dark` blocks — both deliberately near-neutral.

Two orthogonal switches on `<html>`:

- `dark` class → light vs dark within a palette family.
- `data-theme="<preset>"` → palette family. **The default preset writes no
  attribute**; tokens fall back to `:root` / `.dark`.

Preset themes are static CSS blocks at the end of `globals.css`:
`[data-theme="paper"]` redefines the full light token set,
`[data-theme="paper"].dark` the full dark set. No runtime color computation.

Rules for editing or adding presets:

- A preset block must declare **exactly the baseline token set** (radius
  tokens excepted). `pnpm check:themes` (`scripts/check-theme-tokens.mjs`)
  fails the build check otherwise — it derives the preset list by parsing
  `THEME_PRESETS` out of `src/lib/theme.ts`, so keep that array's simple
  one-string-per-line shape.
- The preset registry is `THEME_PRESETS` in `src/lib/theme.ts`; picker
  thumbnails mirror a few representative tokens per mode in
  `src/lib/theme-presets.ts` (`THEME_PRESET_PREVIEWS`) and are synced **by
  hand** — the check script does not cover them.
- `--destructive` and `--success` must stay distinguishable from the preset's
  accent (forest shifts `--success` hue for this reason). Body text contrast
  ≥ WCAG AA 4.5:1 in every palette.
- Mermaid's dark variables in `chat/Markdown.tsx` are hardcoded neutral-gray
  hex shared by all presets (khroma cannot parse oklch); shiki follows the
  `dark` class via Streamdown's `dark:` classes. Neither is per-preset —
  deliberate trade-off, not a gap.

## Preference persistence

Signed-in users: **the DB is the single source of truth** — `users.theme_mode`
(`light`/`dark`/`system`, default `system`) and `users.theme_preset` (default
`default`), read every request by the root layout via
`getUserThemePreference` and rendered into `dark` class + `data-theme`
server-side (no flash). Column values are re-validated on read
(`parseThemeMode`/`parseThemePreset` degrade unknown values to defaults).

The `pika_theme` cookie survives but is demoted to two roles:

1. Theme source for **anonymous pages** (sign-in etc., where there is no
   session).
2. The **resolved hint for `mode=system`** — the server cannot probe the OS
   preference, so the cookie's `resolved` segment decides the first paint.

Format is `mode:resolved:preset`; `parseThemeCookie` still accepts the legacy
two-segment form (preset → `default`). Every local change rewrites the cookie
so anonymous pages stay consistent after sign-out.

Write path: `useUpdateThemePreference` (`src/hooks/`) — optimistic local apply
via `persistTheme` (class + `dataset.theme` + cookie), `PATCH
/api/account/preferences` with the **full preference** (both fields required;
no partial patches), `router.refresh()` on success, revert + localized toast
on failure (`Errors.actions.updateTheme`). `ThemeControl` (sidebar + settings)
and `ThemePresetControl` (settings/general appearance section) both go through
this hook — do not write the cookie or PATCH from anywhere else.

Do not add a try/catch fallback around the layout's preference read:
`resolveActor` already hit the DB for the session, so a failure there 500s
first; the extra catch protected a scenario that cannot occur.

## Settings UI

The preset picker lives in `settings/general` (`ThemePresetControl`,
`src/components/settings/`): a grid of swatch-card `<button aria-pressed>`
with inline-styled oklch thumbnails (sanctioned dynamic-value inline style),
following the resolved light/dark mode via `useSyncExternalStore` on
`prefers-color-scheme`. The grid includes `default` so the choice is
reversible.

## Generated-territory note

`src/components/ui/toast.tsx` (shadcn Base-UI toast, added for the failure
toast) carries sanctioned hand edits — the `cn` import points to
`@/lib/utils`, and the close-button `aria-label` is localized via
`useTranslations("Common")`. A shadcn regen silently reverts both; re-apply
after any regen (same status as the dropdown-menu cursor edits).
