# Theme Switching on Next 16 / React 19

Question: what mechanism writes the `.dark` class that `globals.css` already
expects, without a flash of the wrong theme on first paint?

Verified 2026-08-31 against the npm registry and the upstream issue tracker.

## What the repo already provides

`src/app/globals.css` declares `@custom-variant dark (&:is(.dark *))` and a
complete `.dark` token block including the `--sidebar-*` family. So the
mechanism only has to put `dark` on `<html>`; no CSS work is needed.

`src/app/layout.tsx` is a Server Component and already computes
`<html className={...}>` from the two font variables, so adding a
server-computed theme class there is a one-line change.

## Option 1 — `next-themes` (the default reflex)

**Rejected.** It is the standard choice and it is currently unmaintained and
broken-ish on this exact stack.

- Latest is `0.4.6`, published **2025-03-11** — no release in roughly 17
  months (`npm view next-themes time.0.4.6`).
- `peerDependencies` do allow `react ^19`, so it installs cleanly.
- Open issue [#387](https://github.com/pacocoursey/next-themes/issues/387),
  filed 2026-03-24 against Next 16.2.1 and still open: React 19 logs
  `Encountered a script tag while rendering React component` because the
  library renders its FOUC-prevention `<script>` inside a Client Component.
  This project is on `next@16.3.3` / `react@19.2.8`, so it applies.
- Impact is a dev-only console warning, not a crash, and the thread has a
  one-line workaround (`scriptProps={{ type: "application/json" }}`) that makes
  React skip the tag. But it is a workaround against an unmaintained package,
  and `0xcadams` argues in-thread that it papers over what React is actually
  complaining about rather than fixing it.

## Option 2 — a community fork

**Rejected.** `@teispace/next-themes` and `@wrksz/themes` both exist, both
advertise fixes for #387 plus cookie storage and `useSyncExternalStore`. The
fork authors are also the ones promoting them in the upstream issue thread and
in a DEV article, and they are weeks-to-months old with negligible download
history. For a self-hosted product where the operator inherits our dependency
tree, swapping a 22M-downloads/week package for an unvetted namespace fork is a
worse trade than writing the ~80 lines ourselves.

## Option 3 — cookie-backed, hand-rolled

**Chosen.** The only thing `next-themes` really buys is the blocking inline
script that reads `localStorage` before first paint. A cookie removes the need
for that script entirely, because the server can read it:

1. `layout.tsx` (already a Server Component) reads the theme cookie with
   `next/headers` and renders `<html className={cn(..., resolved === "dark" &&
   "dark")}>`. Correct on first paint, no script, no flash, no hydration
   mismatch.
2. A small client control writes the cookie and toggles
   `document.documentElement.classList` so the change is instant without a
   round trip.
3. `system` is the one case the server cannot resolve, because
   `prefers-color-scheme` is not sent on a normal request. Store the *resolved*
   value in the cookie alongside the chosen mode, and have the client correct
   it via `matchMedia` when the OS preference disagrees or changes. The only
   possible flash is the very first visit before any cookie exists.

Cost: roughly 80 lines and no dependency. It also keeps `layout.tsx` a Server
Component, which `component-guidelines.md` requires anyway.

Note for later: `Sec-CH-Prefers-Color-Scheme` would let the server resolve
`system` on the first visit too, but it is Chromium-only and needs a
`Accept-CH` opt-in round trip. Not worth it for one first-paint frame.
