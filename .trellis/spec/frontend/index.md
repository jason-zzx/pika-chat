# Frontend Development Guidelines

> Client-side conventions for pika-chat: React 19 in the Next.js App Router,
> Tailwind 4, shadcn/ui, TanStack Query, and Zustand.

---

## Status of this spec

**App shell landed (`08-31-app-shell`).** Source of the original decisions:
`.trellis/tasks/00-bootstrap-guidelines/research/tech-stack-decision.md`.

Divergences from the first draft of this spec:

- shadcn/ui CLI v4 defaulted to Base UI (`@base-ui/react`) rather than Radix.
  `components/ui/` remains generated territory; do not hand-edit those files.
- AppShell lives at `components/layout/AppShell.tsx`; `(app)/layout.tsx` is the
  session guard that renders it.
- Administration is under `(app)/settings/`, not an `admin/` page route. The
  `/api/admin/*` endpoints are unrelated and stay where they are.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19 |
| Styling | Tailwind CSS 4 (config in CSS, not `tailwind.config.js`) |
| Components | shadcn/ui primitives (Base UI under the hood as of CLI v4) |
| Server state | TanStack Query 5 |
| Client state | Zustand 5 |
| Chat streaming | `@ai-sdk/react` `useChat` |
| Validation | Zod, schemas shared with the server |

TanStack Query is not an arbitrary pick. It runs unchanged in React Native, so
the data layer survives into a future mobile client alongside the Route
Handlers it calls.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Where components, hooks, and stores go |
| [Component Guidelines](./component-guidelines.md) | Server/client boundary, composition, responsive layout |
| [Hook Guidelines](./hook-guidelines.md) | Query hooks, `useChat`, custom hook rules |
| [State Management](./state-management.md) | The Zustand / TanStack Query boundary |
| [Type Safety](./type-safety.md) | Shared Zod contracts, inference, forbidden escapes |
| [Quality Guidelines](./quality-guidelines.md) | Lint, tests, accessibility, performance |

---

## Pre-Development Checklist

- [ ] Can this stay a Server Component? Only add `"use client"` when the
      component genuinely needs state, effects, or event handlers.
- [ ] Is this data server state or client state? Server state goes in TanStack
      Query, never copied into Zustand.
- [ ] Does the request/response type come from a shared Zod schema rather than
      a hand-written interface?
- [ ] Does this render correctly at both the mobile and desktop breakpoints?
      Both layouts are first-class, not one plus a patch.
- [ ] Is there a loading state, an empty state, and an error state? Chat UIs
      spend real time in all three.
- [ ] Is a shadcn/ui primitive already available instead of a new component?
- [ ] Does anything here assume a cookie session in a way a bearer-token client
      would break?

## Quality Check

- [ ] `pnpm lint` and `pnpm typecheck` pass.
- [ ] `pnpm test` passes.
- [ ] No `any`, no `!` assertion, no unchecked `as` added.
- [ ] `"use client"` sits at the narrowest component that needs it, not on a
      page or layout.
- [ ] No server state duplicated into a Zustand store.
- [ ] Verified at both breakpoints, including that the mobile navigation
      actually opens and closes.
- [ ] Interactive elements are keyboard reachable and labelled.
- [ ] No secret, API key, or admin-only data reached a client component's
      props.

---

**Language**: spec files are written in English.
