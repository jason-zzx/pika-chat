# App Shell — Execution Plan

Ordered so each step leaves the app running. `design.md` has the file map and
contracts; this is the sequence and the checks.

## Step 0 — Branch

- [ ] `git checkout -b feat/app-shell` from `main`, then
      `python3 ./.trellis/scripts/task.py set-branch 08-31-app-shell feat/app-shell`

## Step 1 — Generate the primitives

- [ ] `pnpm dlx shadcn@4.19.0 add sidebar input label select dropdown-menu`

`sidebar` transitively pulls `sheet`, `tooltip`, `separator`, `skeleton`, and
`hooks/use-mobile.ts`.

**Verify before writing any code against them** — the registry source imports
`IconPlaceholder` from `@/app/(create)/components/icon-placeholder`, which does
not exist here (`research/shadcn-sidebar-primitive.md`, risk 1):

- [ ] `rg "app/\(create\)" src/` returns nothing
- [ ] `pnpm typecheck` passes on the generated files alone

If that import survived, replace it with the lucide icon the CLI should have
emitted (`PanelLeftIcon`) and note it — that is a generated-file fix, the one
case where editing `components/ui/` is justified.

Commit point: generated primitives only.

## Step 2 — Theme, bottom-up

- [ ] `src/lib/theme.ts` — cookie name, Zod schema, `parseThemeCookie`
      (fallback `{ mode: "system", resolved: "light" }`), `serializeThemeCookie`
- [ ] Unit-test `parseThemeCookie` against absent, malformed, and each valid
      value **before** wiring it into the layout
- [ ] `app/layout.tsx` — read the cookie, add `dark` to the existing
      `<html className={...}>`; it stays a Server Component
- [ ] `components/layout/ThemeControl.tsx` (`"use client"`) — writes the
      cookie, toggles `document.documentElement.classList`, subscribes to
      `matchMedia` when mode is `system`, reconciles on mount

Verify: set dark, reload, confirm dark first paint. Then disable JavaScript and
reload — still dark, which is the whole point of the cookie approach (AC8).
Then set `system` and flip the OS scheme with the page open (AC9).

Rollback point: theme is self-contained and touches nothing else.

## Step 3 — Shell

- [ ] `components/common/EmptyState.tsx`
- [ ] `components/layout/PageContainer.tsx`, `PageHeader.tsx` — replacing the
      `mx-auto flex w-full max-w-* flex-1 flex-col gap-* p-6` copies (R7)
- [ ] `components/layout/SidebarUserMenu.tsx` (`"use client"`) — username,
      settings link, `ThemeControl`, sign-out; reuses `SignOutButton`'s logic
- [ ] `components/layout/AppSidebar.tsx` — header / content / footer per
      `design.md`; list region renders `EmptyState`
- [ ] `components/layout/AppShell.tsx` — `SidebarProvider` + `Sidebar` +
      `SidebarInset`, `children` and identity as props
- [ ] `(app)/layout.tsx` — read `sidebar_state`, render
      `<AppShell defaultSidebarOpen={...} user={...}>{children}</AppShell>`

Verify at both breakpoints before continuing: desktop panel persists across
navigation; mobile trigger opens the drawer, dismissal closes it (AC1, AC2).
Confirm `rg "hidden md:block" src/components/layout/` is empty (AC3).

Do not proceed to Step 4 with the shell unverified — every later step renders
inside it.

## Step 4 — Settings routes

Move, then delete; keep the tree compiling at each substep.

- [ ] `(app)/settings/layout.tsx` — tab strip, active tab from `usePathname`
      in a client leaf; users tab rendered only for staff
- [ ] `(app)/settings/general/page.tsx` — appearance, hosting `ThemeControl`
- [ ] `(app)/settings/account/page.tsx` — move `ChangePasswordForm` in, drop
      the inline "Back" link
- [ ] `(app)/settings/users/layout.tsx` — `resolveActor` + `isStaffRole`,
      redirect to `/settings/general`
- [ ] `(app)/settings/users/page.tsx` — `RegistrationToggle` +
      `AdminUsersScreen actor={actor}`
- [ ] Delete `(app)/account/`, `admin/layout.tsx`, `admin/users/page.tsx`
- [ ] Update the two `<Link>`s in `(app)/page.tsx` and `README.md:45-46`

**Risky:** `src/app/api/admin/settings/route.ts` and `/api/auth/admin/*` are
API paths and must survive. After deleting, confirm the admin API still exists
and `RegistrationToggle` still works. See "Do not touch" in `design.md`.

Verify: `/settings/users` as a `user`-role account redirects away and the tab
is absent (AC6). `rg -n "\"/account\"|/admin/users" src/ README.md` returns
nothing (AC7).

## Step 5 — Rewrite `/` and adopt the primitives

- [ ] `(app)/page.tsx` — chat empty state via `EmptyState`; the identity line,
      nav links, and sign-out button move into the sidebar footer
- [ ] Replace the 22 raw form elements with `Input` / `Label` / `Select` in
      `AdminUsersScreen`, `CredentialsForm`, `SignInForm`, `ChangePasswordForm`
      (R8)

`SignInForm.test.tsx` asserts on the `/sign-up` link and form behaviour; it
must keep passing without being edited. If it breaks, the markup change went
too far.

Verify: `rg -n "rounded-md border border-input bg-background" src/` returns
nothing (AC11).

## Step 6 — Tests

Per the table in `design.md`: `parseThemeCookie`, `ThemeControl` cookie/class
per mode, `ThemeControl` following a `matchMedia` change, the settings tab strip
hiding the users tab, and a sidebar nav item closing the mobile drawer.

## Step 7 — Full-scope validation

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Then the manual pass that no command covers:

- [ ] Desktop and mobile widths × light and dark: sign-in, sign-up, setup,
      `/`, and all three settings tabs (AC10)
- [ ] Tab through the shell — visible focus everywhere, every icon-only button
      announces a name (AC13)
- [ ] `ls src/stores` does not exist (AC15)

## Definition of done

All of AC1–AC15 in `prd.md` verified. Then Phase 3.3: `directory-structure.md`
needs three corrections recorded during planning — AppShell as a component
rather than `(app)/layout.tsx` (D-SHELL-1), `admin/` retired in favour of
`settings/` (D-SETTINGS-1), and `state-management.md`'s "fetch the current user
with a query hook" clarified to allow an RSC prop (D-STATE-2).
