# App Shell and Responsive Layout

## Goal

Give pika-chat a real frame: one responsive shell the authenticated surface
renders into, a settings area reached from it, and a theme system that actually
toggles.

Today `(app)/layout.tsx` is a login guard wrapping a bare `div`, every screen
hand-rolls its own `mx-auto max-w-* p-6` container, and the dark palette sitting
in `globals.css` is unreachable because nothing ever writes `.dark`.

This task owns the visual system that `assistants-topics`, `chat-streaming`,
and `providers` will render inside. It also inherits D-SCOPE-1 from
`08-31-auth-users`: the deliberately plain screens that task shipped are this
task's to absorb into the frame.

## Background

Source decisions: D-SCOPE-1 in
`.trellis/tasks/archive/2026-08/08-31-auth-users/prd.md`. Conventions:
`.trellis/spec/frontend/`, in particular `component-guidelines.md` (responsive
layout, server/client boundary) and `state-management.md` (state ownership).
Research produced by this task: `research/theme-switching-approach.md`,
`research/shadcn-sidebar-primitive.md`.

### Confirmed facts (read from the repo, not recalled)

**F1 — There is no shell.** `src/app/(app)/layout.tsx` resolves the actor,
redirects to `/sign-in`, and returns `<div className="flex min-h-full flex-1
flex-col">{children}</div>`. `src/app/admin/layout.tsx` is the same plus a staff
check. Neither renders navigation.

**F2 — Every screen hand-rolls its page container.** `(app)/page.tsx`,
`(app)/account/page.tsx`, and `admin/users/page.tsx` each open with
`<main className="mx-auto flex w-full max-w-{lg,3xl} flex-1 flex-col gap-… p-6">`
and navigate with bare `<Link className="underline">`. No shared page header,
no back affordance beyond those inline links.

**F3 — The dark theme exists but is unreachable.** `globals.css` defines
`@custom-variant dark (&:is(.dark *))` and a complete `.dark` token block
including the `--sidebar-*` family. Nothing in `src/` ever adds the class, and
`next-themes` is not a dependency. No screen has ever been rendered in dark.

**F4 — `components/ui/` holds exactly one primitive, `button.tsx`.** The
registry is `base-nova` on Base UI (`@base-ui/react@1.7.0`), not Radix.

**F5 — 22 raw form elements across 4 files.** `AdminUsersScreen` (8),
`CredentialsForm` (6), `SignInForm` (4), `ChangePasswordForm` (4) hand-style
`<input>` / `<select>` / `<label>` by repeating
`className="rounded-md border border-input bg-background px-3 py-2"`. There is
no `Input`, `Label`, or `Select` primitive to use instead.

**F6 — No hardcoded colors anywhere in `src/`.** A scan for Tailwind palette
classes, hex literals, `rgb(`, and inline `style={{` returned nothing.
Everything already resolves through theme tokens, so enabling dark mode is not a
structural risk — it is a verification pass.

**F7 — Zustand is installed and unused;** `src/stores/` does not exist.
`AppProviders` wires only `QueryClientProvider`.

**F8 — Server-resolved identity is passed as a prop today.**
`admin/users/page.tsx` calls `resolveActor` and renders
`<AdminUsersScreen actor={actor} />`. There is no client-side session hook
anywhere, and `src/lib/auth-client.ts` is used only for mutations.

**F9 — Sibling tasks are unplanned.** `08-31-assistants-topics`,
`08-31-chat-streaming`, and `08-31-providers` are TBD stubs. The shell lands
before the content that fills it.

**F10 — jsx-a11y is enforced** and `quality-guidelines.md` makes its findings
non-negotiable, so icon-only nav buttons need labels from the first commit.

## Decisions

**D-IA-1 — Two-column desktop layout.** One sidebar plus one content region.
The sidebar is internally sectioned: header at the top, list region in the
middle (topics, once `assistants-topics` lands), and a current-user menu at the
bottom carrying the settings entry, the theme control, and sign-out.

Mobile puts that same sidebar behind a drawer. Desktop sidebar and mobile drawer
are one component tree in two containers, never two trees toggled with
`hidden md:block` — `component-guidelines.md` names that duplication as the
point where the two layouts start diverging.

Rejected: a three-column Cherry Studio layout (icon rail + list + conversation).
It reserves room for an always-visible assistant switcher, but collapsing two
structural columns into one drawer forces either nested in-drawer navigation or
a bottom tab bar. Revisit if an always-visible assistant switcher becomes a
requirement.

**D-IA-2 — Build on the shadcn `sidebar` primitive.** Verified available for
the `base-nova` style on Base UI. It already implements the single-tree reflow
D-IA-1 requires (`Sheet` on mobile, fixed panel on desktop, identical
`children`), and it persists open/collapsed in a `sidebar_state` cookie that a
Server Component reads to set `defaultOpen`. Details and the risks to check
after `shadcn add`: `research/shadcn-sidebar-primitive.md`.

**D-SHELL-1 — AppShell is a component, not a layout file.** It lives at
`src/components/layout/AppShell.tsx`; `(app)/layout.tsx` renders it. Route
groups and the frame stay orthogonal, so each layout keeps its own guard: `(app)`
checks the session, `settings/users` adds the role check on top. `(auth)` keeps
its centred layout — a sign-in page has no sidebar.

This deviates from `directory-structure.md`, which annotates `(app)/layout.tsx`
itself as "AppShell — the responsive frame".

**D-SHELL-2 — No placeholder routes.** Regions belonging to unbuilt sibling
tasks render empty states in place. This task creates no route for a feature it
does not implement.

**D-SETTINGS-1 — Administration is reached through settings, and settings is a
route.** The sidebar's bottom-left control opens `/settings`, whose tabs are
route segments: `/settings/general` (appearance), `/settings/account` (change
password), `/settings/users` (staff only). They live under `(app)/settings/`, so
they inherit AppShell and the session guard. The staff role check moves to
`settings/users/layout.tsx`; the `admin/` route root is retired and its two
screens move with it. `(app)/page.tsx`'s inline links are rewritten.

`state-management.md` already assigns "admin tab" to the route rather than a
store, so refresh, back-button, and shareable links hold, and `providers` adds
its tab by adding a segment. This is the second deviation from
`directory-structure.md`, which has `admin/` as a real path segment.

**D-THEME-1 — Cookie-backed theme, hand-rolled, three modes.** `light`, `dark`,
`system`, persisted per browser in a cookie. `layout.tsx` stays a Server
Component and reads the cookie to render `<html class="dark">` correctly on
first paint; a leaf client control writes the cookie and flips the class
immediately. For `system` the cookie carries the resolved value and the client
corrects it via `matchMedia`.

Rejected: `next-themes` — unmaintained since 2025-03-11, with open React 19
script-tag issue #387 filed against this exact Next 16 / React 19 pair — and its
community forks, which are weeks old, self-promoted in that issue thread, and
carry negligible adoption for a dependency our operators inherit. Full analysis:
`research/theme-switching-approach.md`.

Rejected: per-user theme synced across devices. It needs a preferences table, a
migration, an endpoint, and a query hook — backend scope inside a frontend shell
task — for a preference that legitimately differs per device.

**D-STATE-1 — No Zustand store in this task.** Sidebar open/closed belongs to
the shadcn `SidebarProvider` (D-IA-2), theme is a cookie plus a leaf client
component (D-THEME-1), and the active settings tab is the route
(D-SETTINGS-1). Nothing is left that needs global client state, so `src/stores/`
is not created speculatively. `state-management.md` permits Context for stable,
infrequently changing values; its ban targets Context for frequently changing
ones.

**D-STATE-2 — Shell identity comes down as a prop from the server.** `(app)
/layout.tsx` already resolves the actor, so the sidebar footer receives the
username and role as props rather than fetching them client-side. This follows
the precedent already in the repo (F8) and keeps the shell out of the client
bundle. `state-management.md` says the current user is "server state, fetch it
with a query hook"; that sentence is aimed at forbidding a Zustand mirror, and
an RSC prop satisfies the same intent without a client fetch. Third item for
Phase 3.3 to reconcile in spec.

**D-RESTYLE-1 — Middle-tier restyle.** Route migration, one shared page
container and page header, and replacing the 22 raw form elements (F5) with
`input` / `label` / `select` primitives. No visual redesign.

F6 removes the urgency for more: nothing is at risk in dark mode. But those
screens are being touched anyway for D-SETTINGS-1, and `/settings/general` needs
form controls too, so extracting the primitives now avoids copies 23 onward.

Explicitly not fixed here: `AdminUsersScreen`'s `window.prompt` password reset,
and the users list as a card stack. Both are real defects; both are auth-task
functionality, and fixing them pulls in dialog and table primitives plus test
surface.

**D-EMPTY-1 — Real empty states, no fake data.** The sidebar list region and
`/` render reusable empty-state components. `component-guidelines.md`'s
pre-development checklist treats loading, empty, and error states as first-class
deliverables, so these are real work that `assistants-topics` and
`chat-streaming` will keep and feed data into — not scaffolding to be thrown
away. No skeleton rows standing in for topics that do not exist.

Accepted cost: the list region's overflow and scroll behaviour under many items
is not exercised until topics land.

## Requirements

**R1 — AppShell.** `src/components/layout/AppShell.tsx` renders a two-column
frame: sidebar plus content region. It is composed from the shadcn `sidebar`
primitive, receives its children and the current user's identity as props, and
carries no `"use client"` above the leaves that need it.

**R2 — One tree at both breakpoints.** The sidebar's contents are authored once.
Desktop renders them in a persistent panel; mobile renders the same subtree in a
drawer. No `hidden md:block` pair of parallel trees.

**R3 — Sidebar composition.** Header with the product name and a primary "new
chat" action; a list region for topics; a footer holding the current user, a
settings entry, the theme control, and sign-out. Icon-only controls are
labelled.

**R4 — Shell coverage.** `(app)/layout.tsx` renders AppShell for every
authenticated route including `/settings/*`. `(auth)` keeps its centred layout.
Existing guards keep working unchanged.

**R5 — Settings routes.** `/settings/general`, `/settings/account`, and
`/settings/users` exist under `(app)/settings/` with a shared tab navigation
that marks the active tab. `/settings/users` is staff-only, enforced in its
layout server-side. `/account` and `/admin/users` no longer exist; the `admin/`
route root is removed and every in-app link points at the new paths.

**R6 — Theme.** A control offers light, dark, and system. The choice persists
across reloads in a cookie, the server renders the correct class on first paint
with no flash, and `system` follows OS changes without a reload. The control
appears in the sidebar footer and on `/settings/general`.

**R7 — Shared page conventions.** One page container and page-header component
that every settings screen and `/` uses, replacing the per-file
`mx-auto max-w-* p-6` copies.

**R8 — Form primitives.** `input`, `label`, and `select` primitives are added
and all 22 raw form elements in the four existing files use them. No new raw
`<input>` is introduced by this task.

**R9 — Empty states.** A reusable empty-state component renders in the sidebar
list region and on `/`. `/` explains that a provider must be configured before
chatting. No fake or placeholder data ships.

**R10 — Accessibility.** Every shell control is keyboard reachable with a
visible focus style, icon-only buttons carry an `aria-label`, and the mobile
drawer opens, closes, and closes again after navigating.

## Acceptance Criteria

- [ ] **AC1** At a desktop width, an authenticated route shows the sidebar and
      the content region side by side; the sidebar persists across navigation.
- [ ] **AC2** At a mobile width, the sidebar is off-screen, a labelled trigger
      opens it as a drawer, it closes by dismissal, and it closes again after
      following a link inside it.
- [ ] **AC3** The sidebar's contents are defined in one place: no component in
      `components/layout/` renders a second copy of the nav gated by
      `hidden md:block`.
- [ ] **AC4** Collapsing the desktop sidebar survives a reload without a flash
      of the wrong state.
- [ ] **AC5** `/settings/general`, `/settings/account`, and `/settings/users`
      render inside AppShell with the active tab marked.
- [ ] **AC6** A `user`-role account gets redirected away from `/settings/users`,
      and the tab is not offered to them.
- [ ] **AC7** `/account` and `/admin/users` are gone from `src/app/`, and no
      link, redirect, or test in the repo still points at either.
- [ ] **AC8** Choosing dark then reloading yields a dark first paint with no
      light flash, verified with JavaScript disabled for the initial render.
- [ ] **AC9** With the theme set to `system`, changing the OS colour scheme
      updates the page without a reload.
- [ ] **AC10** Sign-in, sign-up, setup, account, and users screens are each
      legible in both themes, with no element rendering foreground on
      same-coloured background.
- [ ] **AC11** No raw `<input>`, `<select>`, or `<label>` with hand-written
      border/background classes remains in `src/components/`.
- [ ] **AC12** `/` and the empty sidebar list region render an empty state; a
      search of the diff finds no hardcoded sample topic or user.
- [ ] **AC13** Every shell control is reachable by keyboard with a visible focus
      ring, and every icon-only button has an accessible name.
- [ ] **AC14** `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass, and the
      existing 33 tests still pass after the route migration.
- [ ] **AC15** `src/stores/` does not exist, and no server-derived value is held
      in client state.

## Out of Scope

- Topic, assistant, provider, and message data or CRUD — the sibling tasks own
  these; this task only renders their regions with empty states (D-SHELL-2).
- Per-user theme synced across devices (D-THEME-1).
- `AdminUsersScreen`'s `window.prompt` password reset and its card-stack user
  list (D-RESTYLE-1).
- Any visual redesign beyond containers, page headers, and form primitives
  (D-RESTYLE-1).
- A three-column layout and an always-visible assistant switcher (D-IA-1).
- Editing the generated files under `components/ui/`; project-wide changes go in
  wrappers under `components/layout/`.
