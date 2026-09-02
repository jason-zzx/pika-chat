# Directory Structure

> Where client-side code lives.

---

## Layout

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── invite/[token]/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              # session guard; renders AppShell
│   │   ├── page.tsx
│   │   ├── settings/               # general / account / users (staff)
│   │   └── t/[topicId]/page.tsx    # a topic's conversation
│   ├── layout.tsx                  # root: providers, fonts, theme cookie
│   └── globals.css                 # Tailwind 4 config lives here
├── components/
│   ├── ui/                         # shadcn/ui primitives — generated (Base UI)
│   ├── layout/                     # AppShell, sidebar, page chrome
│   ├── chat/                       # message list, composer, model picker
│   ├── assistant/
│   ├── topic/
│   ├── provider/
│   └── common/                     # cross-domain: EmptyState, ErrorState
├── hooks/                          # cross-domain hooks only
├── stores/                         # Zustand stores; create on first real store
├── lib/
│   ├── api/                        # typed fetch client per domain
│   ├── schemas/                    # Zod contracts shared with the server
│   └── utils.ts                    # cn() and friends
└── types/
```

---

## Placement rules

**Domain folder over generic folder.** A component used by one domain lives in
that domain's folder, next to the others it collaborates with. `components/`
grows flat and unnavigable otherwise.

**Promote on second use, not in anticipation.** A hook used by one domain
belongs in that domain folder. Move it to `hooks/` when a second domain
actually needs it. Guessing at reuse produces abstractions shaped for one
caller.

**`components/ui/` is generated territory.** These are shadcn/ui primitives
pulled in by the CLI. Wrap them, compose them, but avoid hand-editing — edits
are lost on regeneration and diverge from upstream docs. If a primitive needs
a project-wide change, wrap it in `components/common/` and use the wrapper.

**Schemas are shared, not duplicated.** `lib/schemas/` holds Zod schemas
imported by both the client and the Route Handlers. Never hand-write a
TypeScript interface mirroring a server response — see
[Type Safety](./type-safety.md).

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Component file | `PascalCase.tsx` | `MessageList.tsx` |
| One component per file | default-exported, name matches file | |
| Hook file | `use-kebab-case.ts` | `use-topic-list.ts` |
| Hook export | `useCamelCase` | `useTopicList` |
| Store file | `<concern>-store.ts` | `ui-store.ts` |
| API client | `<domain>.ts` in `lib/api/` | `topics.ts` |

---

## Route groups

`(auth)` and `(app)` are route groups, so they share a URL space but not a
layout. `(app)/layout.tsx` is the session guard; it renders `AppShell` from
`components/layout/AppShell.tsx`. Putting the guard on the route-group layout
means a new authenticated page cannot forget it. The shell itself is a
component so `(auth)` can keep a centred layout with no sidebar.

Settings live under `(app)/settings/` so they inherit the shell and the
session check. `/settings/users` adds a staff role check in its own layout.
On `/settings/*` the sidebar replaces the assistant list with Back + Settings
tab rows; the settings page itself has no top tab bar. There is no `admin/`
page route; `/api/admin/*` and `/api/auth/admin/*` are API paths and are
unrelated.
