# shadcn `sidebar` on the `base-nova` Registry

Verified 2026-08-31 with `pnpm exec shadcn view sidebar`, which resolved
`https://ui.shadcn.com/r/styles/base-nova/sidebar.json`. Findings are from that
payload, not from the Radix-era docs.

## It exists for our style, on Base UI

`components.json` pins `"style": "base-nova"` and the project depends on
`@base-ui/react@1.7.0`, not Radix. The registry serves a Base UI implementation
of `sidebar` for that style — it imports `mergeProps` and `useRender` from
`@base-ui/react`. So "reach for a shadcn primitive first"
(`component-guidelines.md`) is available here and does not drag Radix in.

## Why it settles the hardest constraint in this task

`component-guidelines.md` requires that the desktop sidebar and the mobile
drawer be one component tree, explicitly forbidding two parallel trees toggled
with `hidden md:block`. The primitive already implements exactly that: inside
`Sidebar`, `useIsMobile()` picks the container, and `children` is identical
either way.

```
if (isMobile) {
  return <Sheet open={openMobile} onOpenChange={setOpenMobile}>
           <SheetContent side={side} …>{children}</SheetContent>
         </Sheet>
}
return <div className="… hidden md:block" …>{children}</div>
```

Writing this ourselves means re-deriving the breakpoint hook, the Sheet
wiring, the `sr-only` Sheet title (a11y), and the desktop gap/offset element.

## What it brings along

`registryDependencies`: `button`, `input`, `separator`, `sheet`, `skeleton`,
`tooltip`, `use-mobile`. `button` is already present, so `shadcn add sidebar`
pulls in six new files under `components/ui/` plus `hooks/use-mobile.ts`.

Exports we will actually use: `SidebarProvider`, `Sidebar`, `SidebarHeader`,
`SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarMenu`,
`SidebarMenuItem`, `SidebarMenuButton`, `SidebarTrigger`, `SidebarInset`,
`SidebarRail`.

## Open/collapsed state is already cookie-backed

`SidebarProvider` writes a `sidebar_state` cookie on every toggle
(`SIDEBAR_COOKIE_NAME = "sidebar_state"`, max-age 7 days) and accepts a
`defaultOpen` prop. A Server Component layout reads that cookie with
`next/headers` and passes `defaultOpen`, so the desktop collapsed state
survives reload without a flash — the same pattern this task uses for the
theme.

**Consequence: this task needs no Zustand store.** Sidebar open/closed is the
one candidate for global client state, and the primitive owns it. Theme is a
cookie plus a leaf client component. `state-management.md` allows Context for
stable, infrequently changing values, which the sidebar flag is; its ban is on
Context for frequently changing values. `src/stores/` should not be created
speculatively.

It also binds `Cmd/Ctrl+B` to toggle, which is free keyboard access.

## Risks to verify at implement time

1. **`IconPlaceholder` import.** The registry source imports
   `IconPlaceholder` from `@/app/(create)/components/icon-placeholder`, a
   registry-internal component that does not exist here. The CLI is expected to
   resolve it against `"iconLibrary": "lucide"` in `components.json` and emit a
   plain lucide `PanelLeftIcon`. Check the generated file immediately after
   `shadcn add` and confirm no `@/app/(create)/…` import survives — that path
   would fail typecheck.
2. **`useIsMobile` returns `undefined` on first render** before `matchMedia`
   resolves. Confirm the initial paint does not flash the wrong container.
3. **`components/ui/` is generated territory** per `directory-structure.md`.
   Any project-wide change to these files goes in a wrapper under
   `components/layout/`, not by hand-editing the generated primitive.
