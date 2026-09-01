# Implement — Assistants and Topics

Read `prd.md` then `design.md` first. Every step below names the decision or
acceptance criterion it serves; if a step seems to contradict one, stop and
raise it rather than resolving it in code.

## Order

Backend before frontend, and the migration before anything that imports the
schema. Steps 1–6 are independently verifiable without any UI.

### 1. Primitives

```bash
pnpm exec shadcn add dialog alert-dialog textarea
```

- Inspect all three generated files for a surviving `@/app/(create)/…` import —
  the leak `08-31-app-shell` recorded in
  `research/shadcn-sidebar-primitive.md:65`. Replace with the lucide equivalent
  if present. (AC16)
- Do not hand-edit them beyond that fix (`frontend/directory-structure.md:52`).
- `pnpm typecheck` must pass before moving on.

### 2. Schema and migration

1. Create `src/server/db/schema/columns.ts` exporting the `timestamptz` helper;
   point `schema/auth.ts` and `schema/provider.ts` at it and delete their local
   copies.
2. Create `src/server/db/schema/assistant.ts` with `assistants` and `topics`
   exactly as specified in `design.md`. Re-export both from `schema/index.ts`.
3. Generate and read the SQL before applying it:

```bash
pnpm db:generate
```

**Gate — do not skip.** Open the generated `0005_*.sql` and confirm:

- it creates only `assistants` and `topics`, and **no message table** (D4);
- `topics.assistant_id` is `NOT NULL` with `ON DELETE CASCADE` (D1, D8);
- `assistants.default_provider_config_id` is `ON DELETE SET NULL` (D11);
- `assistants_owner_name_uidx` and `topics_assistant_id_idx` exist;
- it contains **no `ALTER` touching `users`, `provider_configs`, or
  `provider_models`**. The step-2.1 refactor is byte-identical, so any diff there
  means the helper extraction changed a column definition — fix it rather than
  accepting the ALTER.

Then apply:

```bash
pnpm db:migrate
```

A hand-edited migration is forbidden once applied
(`database-guidelines.md:55`); if the SQL is wrong, fix the schema file and
regenerate before it reaches any other environment.

### 3. Zod contracts

`src/lib/schemas/topic.ts`, then `src/lib/schemas/assistant.ts` importing
`topicSchema` from it. Include `DEFAULT_ASSISTANT_NAME`,
`DEFAULT_ASSISTANT_ICON`, and `DEFAULT_TOPIC_TITLE` — isomorphic, no
`server-only`, because `08-31-chat-streaming` imports `DEFAULT_TOPIC_TITLE`
(D9). Bound `icon` with `max(8)` (design.md, last risk). No `assistantId` on
`createTopicSchema` is optional — it is required and `NOT NULL` (D1).

### 4. Services

`assistant.service.ts` first (`topic.service.ts` imports
`requireOwnedAssistant` from it).

- Ownership is always inside the statement; zero rows → `AppError("NOT_FOUND",
  404, …)`, never `FORBIDDEN` (`error-handling.md:72`).
- `isUniqueViolation` → `409` on duplicate assistant name (AC5).
- The lazy seed uses `onConflictDoNothing` followed by an unconditional re-read
  (AC3, AC4).
- `deleteAssistant` is the one transactional operation (D12). Inside
  `db.transaction()`: a `FOR UPDATE` select of the actor's assistant ids, then
  `NOT_FOUND` if the target is absent, then `CONFLICT`/`409` if the count is
  ≤ 1, then the delete. Decide `NOT_FOUND` before `CONFLICT` so probing another
  user's assistant cannot reveal their assistant count. Let the database cascade
  to topics; do not delete children by hand. (AC10, AC10a, AC10b)
- Confirm Drizzle's `.for("update")` actually emits the lock inside the
  transaction. If AC10b fails, drop to an explicit `SELECT … FOR UPDATE` through
  `sql` rather than weakening the assertion.
- Rename/delete of a topic filter through a subquery over the actor's assistant
  ids; do not fetch then check.
- `logger.info` with `userId` on each mutation, matching
  `provider.service.ts:236`. Never log a system prompt.

### 5. Route Handlers

Seven handlers across four files, per the transport table. Each: `requireActor`,
Zod `parse`, one service call, respond. `withErrorHandling` on every export.
`201` on POST, `204` with no body on DELETE. No `GET /api/topics/[id]`
(design.md explains why).

### 6. Service integration tests

The three files named in `design.md`. Extend the `beforeEach` reset to delete
`topics` and `assistants` before the provider and auth tables. Cover AC2, AC3,
AC4, AC5, AC7 (data half), AC8, AC9, AC10, AC10a, AC10b.

```bash
pnpm exec vitest run --project integration
```

Requires `TEST_DATABASE_URL`. Two races run against the real database: AC4 via
`Promise.all` on two list calls, and AC10b via `Promise.allSettled` on two
deletes for an actor holding exactly two assistants — one row must survive and
the loser must fail with `CONFLICT`, not a deadlock or timeout.

### 7. Client API and hooks

`lib/api/assistant.ts`, `lib/api/topic.ts`, and `listAvailableModels()` appended
to `lib/api/provider.ts` — reuse the existing `parseJson` / `parseEmpty` shape
(`lib/api/provider.ts:15-32`). Then
`components/provider/use-available-models.ts` and
`components/assistant/use-assistants.ts` with the key factories from
`design.md`. Every assistant and topic mutation invalidates
`assistantKeys.all`.

### 8. Sidebar tree

`components/assistant/AssistantTree.tsx` (`"use client"`), then swap it into
`AppSidebar.tsx` in place of the New chat header action and the `EmptyState`.
`AppSidebar` itself stays a Server Component.

Reuse `SidebarNavLink` for topic links so mobile-drawer-closes-on-navigate keeps
working for free (AC14). Default the open pane from `useParams()`; keep a local
`useState` override so Back can return to the assistant list without a store
(AC12). Verify the `useParams()` assumption early — the fallback is
`usePathname()` with a prefix match. Do not use `SidebarMenuSkeleton`.

### 9. Dialogs

`AssistantEditorDialog` (create + edit), `DeleteAssistantDialog`, and
`RenameTopicDialog`. The delete confirmation states the topic count from the
cached tree. The sidebar's Delete item is disabled, labelled only "Delete",
when the actor has exactly one assistant, so the dialog needs no
last-assistant wording (D12, AC10c); a `409` arriving anyway from a stale tree
surfaces through `apiErrorMessage`. Model options carry provenance labels; an
unavailable stored pair shows the notice with nothing preselected (R4).

### 10. Topic page

`(app)/t/[topicId]/page.tsx` — Server Component, `findTopicForActor`,
`notFound()` on null, `PageContainer` + `PageHeader` + `EmptyState`, composed
like `(app)/page.tsx:6-13`.

### 11. Component tests

`AssistantTree.test.tsx` and `AssistantEditorDialog.test.tsx` per the testing
table, including AC10c — Delete disabled at one assistant, enabled at two.

```bash
pnpm exec vitest run --project unit-dom
```

### 12. Manual verification

Not covered by the automated suite:

- **AC1** — apply `0005` against a fresh empty database, not just the migrated
  dev one.
- **AC13** — `/t/[topicId]` as owner renders the title; a topic id belonging to
  another user renders not-found.
- **AC14** — at a mobile width: tree, editor dialog, delete confirmation all
  usable; drawer closes after navigating into a topic.
- **AC15** — keyboard-only pass over the tree: every icon-only control has an
  accessible name and a visible focus ring.
- **AC16** — the three generated primitives are unedited apart from the import
  fix.

### 13. Full gate

```bash
pnpm lint
pnpm typecheck
pnpm test
```

All three must pass (AC17). Then run the final full-scope 2.2 check across both
affected packages, per `workflow.md`'s note on the last quality check.

## Risky files and rollback points

| File | Risk | Rollback |
|---|---|---|
| `src/server/db/migrations/0005_*.sql` | Cannot be edited once applied anywhere | Delete the file, its `meta/` snapshot, and its `_journal.json` entry **only** before it has been applied outside your machine; otherwise write a new migration |
| `schema/auth.ts`, `schema/provider.ts` | The `timestamptz` extraction touches shipped tables | The step-2 gate: `db:generate` must produce no `ALTER` for them |
| `components/layout/AppSidebar.tsx` | Renders on every authenticated route; a client-boundary mistake here degrades the whole shell | Commit steps 1–7 before touching it, so a revert of step 8 leaves a working app |
| `components/ui/*` (4 new files) | Generated territory; hand-edits are lost on regeneration | Re-run `shadcn add` |

Suggested commit boundaries: (1) primitives, (2) schema + migration, (3)
contracts + services + routes + integration tests, (4) client API + hooks, (5)
sidebar + dialogs + topic page + component tests. Boundary 3 is the point where
the backend is complete and provable with no UI.

## Before `task.py start`

- `prd.md`, `design.md`, `implement.md` reviewed by the user.
- `implement.jsonl` and `check.jsonl` each carry real curated entries.
- The two spec reconciliations D1 records — `frontend/type-safety.md:24`'s
  nullable `assistantId`, and `08-31-app-shell` R3's topic-only sidebar region —
  are Phase 3.3 work. Do not edit spec during implementation; note them and
  handle them with `trellis-update-spec`.
