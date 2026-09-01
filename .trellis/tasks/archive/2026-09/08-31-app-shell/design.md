# App Shell — Technical Design

Companion to `prd.md`. Requirement IDs (R1–R10) and decision IDs (D-*) refer to
that document.

## File map

```
src/
├── app/
│   ├── layout.tsx                       # MODIFIED — reads theme cookie, sets <html class>
│   ├── (app)/
│   │   ├── layout.tsx                   # MODIFIED — renders AppShell, reads sidebar cookie
│   │   ├── page.tsx                     # REWRITTEN — chat empty state
│   │   ├── account/                     # DELETED  → settings/account
│   │   └── settings/
│   │       ├── layout.tsx               # NEW — tab navigation
│   │       ├── general/page.tsx         # NEW — appearance
│   │       ├── account/page.tsx         # MOVED from (app)/account
│   │       └── users/
│   │           ├── layout.tsx           # NEW — staff role check
│   │           └── page.tsx             # MOVED from admin/users
│   └── admin/                           # DELETED — page routes only, see "Do not touch"
├── components/
│   ├── layout/                          # NEW
│   │   ├── AppShell.tsx
│   │   ├── AppSidebar.tsx
│   │   ├── SidebarUserMenu.tsx          # "use client"
│   │   ├── ThemeControl.tsx             # "use client"
│   │   ├── PageContainer.tsx
│   │   └── PageHeader.tsx
│   ├── common/
│   │   └── EmptyState.tsx               # NEW
│   └── ui/                              # GENERATED — shadcn add
│       ├── sidebar.tsx  sheet.tsx  tooltip.tsx  separator.tsx
│       ├── skeleton.tsx  input.tsx  label.tsx  select.tsx
│       └── dropdown-menu.tsx
├── hooks/
│   └── use-mobile.ts                    # GENERATED — sidebar dependency
└── lib/
    └── theme.ts                         # NEW — cookie name, parsing, shared types
```

## Do not touch

Retiring the `admin/` **page** route root must not touch the **API** routes
that happen to share the word:

- `src/app/api/admin/settings/route.ts` — project-owned, `requireAdmin`,
  consumed by `RegistrationToggle` through `src/lib/api/instance.ts`.
- `/api/auth/admin/*` — Better Auth's admin plugin, guarded by the hierarchy
  hook in `src/server/auth/hierarchy.ts`, which matches on those literal paths.
- `.trellis/spec/backend/auth-guidelines.md`'s references to `/api/admin/*` are
  about those endpoints and stay accurate.

Only `src/app/admin/layout.tsx` and `src/app/admin/users/page.tsx` are removed.

## Server / client boundary

`component-guidelines.md` forbids `"use client"` on a page or layout, so the
boundary sits at named leaves:

| Component | Kind | Why |
|---|---|---|
| `app/layout.tsx` | Server | Reads the theme cookie; must stay server to set `<html class>` before paint |
| `(app)/layout.tsx` | Server | Resolves the actor, reads `sidebar_state`, passes both down |
| `AppShell`, `AppSidebar` | Server | Pure composition; receives identity as props (D-STATE-2) |
| `PageContainer`, `PageHeader`, `EmptyState` | Server | Presentational |
| `SidebarProvider`, `Sidebar`, `SidebarTrigger` | Client (generated) | Own their client boundary; a Server Component subtree passed as `children` stays on the server |
| `SidebarUserMenu` | Client | Dropdown open state, sign-out handler |
| `ThemeControl` | Client | Writes the cookie, flips the class, `matchMedia` listener |

Identity reaches the footer as props from `(app)/layout.tsx`, which already
calls `resolveActor`. No client session hook is introduced (D-STATE-2, F8).

## Theme contract

Single cookie, two fields, so the server can render `system` correctly without
a blocking script (`research/theme-switching-approach.md`).

| Field | Values | Read by |
|---|---|---|
| mode | `light` \| `dark` \| `system` | `ThemeControl` (to show the active choice) |
| resolved | `light` \| `dark` | `app/layout.tsx` (to set `<html class>`) |

`src/lib/theme.ts` owns the cookie name, a Zod schema for the value, a
`parseThemeCookie` that falls back to `{ mode: "system", resolved: "light" }`
on absent or malformed input, and a `serializeThemeCookie`. Both the Server
Component and the client control import from it, so the format has one
definition.

Flow:

1. `app/layout.tsx` calls `cookies()`, parses, renders
   `<html className={cn(fonts, resolved === "dark" && "dark")}>`.
2. `ThemeControl` on change writes the cookie (`path=/`, `SameSite=Lax`,
   1 year) and synchronously toggles `document.documentElement.classList`, so
   the change is instant with no navigation.
3. When mode is `system`, `ThemeControl` subscribes to
   `matchMedia("(prefers-color-scheme: dark)")`; on change it applies the class
   and rewrites `resolved` so the next server render agrees (R6, AC9).
4. On mount with mode `system`, it reconciles: if the OS disagrees with the
   `resolved` the server used, it corrects the class and the cookie. Only the
   very first visit, before any cookie exists, can show one wrong frame.

`SameSite=Lax` and no `HttpOnly` — the client must write it, and it carries no
security value.

## Sidebar

`AppSidebar` authors the contents once; the generated `Sidebar` picks the
container per breakpoint (`research/shadcn-sidebar-primitive.md`). This is what
satisfies R2/AC3 — there is no place to put a second tree.

```
SidebarProvider defaultOpen={cookie}
├── Sidebar
│   ├── SidebarHeader   — product name, "New chat" primary action
│   ├── SidebarContent  — topic list region → <EmptyState> until assistants-topics
│   └── SidebarFooter   — <SidebarUserMenu>: username, /settings link,
│                          <ThemeControl>, sign out
└── SidebarInset        — {children}
```

`(app)/layout.tsx` reads `sidebar_state` from `cookies()` and passes
`defaultOpen`, matching the primitive's own convention, so desktop collapse
survives reload without a flash (AC4).

Mobile close-after-navigation (AC2) is not automatic: `SidebarMenuButton`
rendering a `Link` leaves the Sheet open. The nav items call `setOpenMobile
(false)` on click, which is why the list items are client leaves.

## Settings routes

`(app)/settings/layout.tsx` renders the tab strip and marks the active tab from
`usePathname` — a small client leaf inside a Server Component layout. Tabs are
links, not buttons, so each is deep-linkable (D-SETTINGS-1).

The users tab is only rendered for staff, and `settings/users/layout.tsx`
repeats the check server-side with `resolveActor` + `isStaffRole`, redirecting
to `/settings/general`. Hiding the tab is UX; the layout check is the
enforcement (AC6). This is the same two-layer pattern the deleted
`admin/layout.tsx` used.

### Migration

| From | To | Notes |
|---|---|---|
| `(app)/account/page.tsx` | `(app)/settings/account/page.tsx` | Body unchanged apart from container and the removal of its inline "Back" link |
| `admin/users/page.tsx` | `(app)/settings/users/page.tsx` | Role check moves to the sibling layout; keeps `<RegistrationToggle />` and `<AdminUsersScreen actor={actor} />` |
| `admin/layout.tsx` | `(app)/settings/users/layout.tsx` | Session check now comes from `(app)`, so only the role check remains |

Referrers to update: `(app)/page.tsx` (two `<Link>`s) and `README.md:45-46`.
A repo scan found no test referencing either page route, and no redirect or
middleware pointing at them.

No back-compat redirects from `/account` or `/admin/users`. This is a
pre-release self-hosted app with no external links to preserve; a redirect
would be permanent dead weight.

## Trade-offs

**Nine generated files for one sidebar.** `shadcn add sidebar` pulls `sheet`,
`tooltip`, `separator`, `skeleton`, `input`, and `use-mobile` alongside it. In
exchange we do not hand-write the breakpoint fork, the Sheet a11y wiring, or
the cookie persistence, and `input` is needed by R8 anyway. `skeleton` and
`tooltip` arrive unused; they are generated territory and cost nothing beyond
tree-shaken files.

**Hand-rolled theme vs. a dependency.** ~80 lines we own, against an
unmaintained package with a live React 19 bug or an unvetted fork. Cost: the
`system` reconciliation is ours to get right, so it needs a test.

**No Zustand (D-STATE-1).** If a later task needs genuinely global client
state, it creates the first store then. Creating `src/stores/` now to "have the
structure" is the speculative abstraction `directory-structure.md` warns
against with its promote-on-second-use rule.

## Testing

Vitest with Testing Library, per `quality-guidelines.md` — behaviour, not
markup; no snapshots.

| Test | Guards |
|---|---|
| `parseThemeCookie` on absent, malformed, and each valid value | The fallback that decides first paint |
| `ThemeControl` writes the cookie and toggles the class for each mode | R6 |
| `ThemeControl` follows a `matchMedia` change while mode is `system` | AC9 |
| Settings tab strip hides the users tab for a `user`-role actor | AC6 (UX layer only; the layout redirect is the enforcement) |
| Sidebar nav item closes the mobile drawer on click | AC2 |

The 33 existing tests must still pass unchanged (AC14); the route migration
touches no module they import.

## Rollback

Every change is additive except the three deletions
(`(app)/account/`, `admin/layout.tsx`, `admin/users/page.tsx`) and the two
modified layouts. Reverting the commit restores the previous frame; there is no
migration, no persisted server state, and no API surface change. A stale
`sidebar_state` or theme cookie in a user's browser is parsed by
`parseThemeCookie`'s fallback rather than throwing.
