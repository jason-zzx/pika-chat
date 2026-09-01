# Design — Assistants and Topics

## Module map

```
src/server/db/schema/columns.ts            extract the thrice-copied timestamptz helper
src/server/db/schema/assistant.ts          assistants + topics (parent and child, one file)
src/server/db/migrations/0005_*.sql        generated
src/server/services/assistant.service.ts   assistant CRUD, lazy seed, the tree query
src/server/services/topic.service.ts       topic CRUD, ownership through the parent
src/lib/schemas/topic.ts                   Zod: topic + create/update inputs
src/lib/schemas/assistant.ts               Zod: assistant (with topics) + create/update inputs
src/app/api/assistants/route.ts            GET tree, POST create
src/app/api/assistants/[id]/route.ts       PATCH, DELETE
src/app/api/topics/route.ts                POST create
src/app/api/topics/[id]/route.ts           PATCH rename, DELETE
src/app/(app)/t/[topicId]/page.tsx         topic shell with a messaging-not-yet empty state
src/lib/api/assistant.ts                   typed fetch client
src/lib/api/topic.ts                       typed fetch client
src/lib/api/provider.ts                    += listAvailableModels()
src/components/provider/use-available-models.ts   the first consumer of GET /api/models
src/components/assistant/use-assistants.ts        query keys + hooks for the whole tree
src/components/assistant/AssistantTree.tsx        "use client" — the sidebar's middle region
src/components/assistant/AssistantEditorDialog.tsx
src/components/assistant/DeleteAssistantDialog.tsx
src/components/topic/RenameTopicDialog.tsx
src/components/layout/AppSidebar.tsx       replace the EmptyState with <AssistantTree />
src/components/ui/{dialog,alert-dialog,textarea}.tsx   shadcn add
```

Two deliberate deviations from the layout the spec sketched (PRD F10):

- **`schema/assistant.ts`, not `schema/topic.ts`.** A topic cannot exist without
  its assistant (D1), so they are one domain, and `schema/provider.ts` already
  sets the precedent of a parent and its child table sharing a file
  (`provider_configs` + `provider_models`).
- **Two service files, not one.** `provider.service.ts` keeps parent and child
  together and is already 406 lines. Splitting keeps each module readable, at
  the cost of exporting `requireOwnedAssistant` from `assistant.service.ts` —
  which `provider.service.ts` keeps private. That export is defensible on its
  own terms: "load an assistant I own, or 404" is a meaningful public operation,
  not an implementation detail leaking out.

`src/lib/schemas/` splits by domain per spec naming: `assistant.ts` imports
`topicSchema` from `topic.ts`. The dependency runs one way only — a topic
contract never mentions an assistant contract — so there is no cycle.

## Data model

`timestamptz` is currently redeclared in `schema/auth.ts` and
`schema/provider.ts`. A third copy is where duplication stops being an accident,
so it moves to `schema/columns.ts` and both existing files import it. The column
definition is byte-identical, so **this produces no migration**.

```ts
export const assistants = pgTable(
  "assistants",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").notNull(),                        // one emoji
    systemPrompt: text("system_prompt"),                 // null: no standing instruction
    defaultProviderConfigId: text("default_provider_config_id")
      .references(() => providerConfigs.id, { onDelete: "set null" }),
    defaultModelId: text("default_model_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assistants_owner_name_uidx").on(t.ownerId, t.name)],
);

export const topics = pgTable(
  "topics",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id").notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("topics_assistant_id_idx").on(t.assistantId)],
);
```

Notes, each tied to a decision:

- **`topics` has no `owner_id`.** Ownership is reached through
  `assistants.owner_id`, exactly as `provider_models` reaches it through
  `provider_configs` (`provider.service.ts:341`). D7 makes assistants private,
  so a topic's owner is its assistant's owner with no exception, and a
  denormalized copy would be a second source of truth for the same fact.
  `database-guidelines.md:69`'s rule is that the *query* filters by owner — a
  join satisfies it; the anti-pattern it forbids is fetch-then-check.
- **`assistant_id` is `NOT NULL` with `onDelete: "cascade"`** — D1 plus D8. This
  is the cascade `database-guidelines.md:165` demands a product decision for, and
  D8 is it. `08-31-chat-streaming` extends the chain with
  `messages.topic_id → topics.id`.
- **`default_provider_config_id` is a real foreign key with `set null`.** It
  closes the structural half of D11 for free: deleting a provider config cannot
  leave a dangling id. `default_model_id` stays plain `text` — it mirrors
  `provider_models.model_id`, a free-form string sent verbatim to the provider,
  and keying the FK on `provider_models.id` instead would break the assistant
  every time a user removes and re-adds the same model id. The semantic half
  (un-shared, or model row removed) has no FK expression and is D11's lazy
  check.
- **A partially-null model pair is a valid state.** With `set null` firing on
  one column, `(null, "gpt-4o")` occurs naturally. The read contract treats the
  model as set only when *both* are non-null; nothing repairs the leftover
  string, because nothing reads it.
- **`(owner_id, name)` unique** does double duty: a real `409` via
  `isUniqueViolation`, and the race guard D5 needs.
- **No `updated_at` on the assistant's model columns, no `visibility`, no
  parameters, no `description`, no `pinned`, no `title_set_by_user`** — D3, D7,
  D9.
- **No `pgEnum` anywhere.** There is no closed-set column in this task.

## Service contracts

```ts
// assistant.service.ts
listAssistantTree(actor): Promise<AssistantTree>        // seeds when empty (D5)
createAssistant(input: CreateAssistantInput, actor): Promise<Assistant>
updateAssistant(id, input: UpdateAssistantInput, actor): Promise<Assistant>
deleteAssistant(id, actor): Promise<void>               // cascades (D8); refuses the last one (D12)
requireOwnedAssistant(id, actor): Promise<AssistantRow> // exported for topic.service

// topic.service.ts
createTopic(input: CreateTopicInput, actor): Promise<Topic>
renameTopic(id, input: RenameTopicInput, actor): Promise<Topic>
deleteTopic(id, actor): Promise<void>
findTopicForActor(id, actor): Promise<Topic | null>     // for the RSC page
```

### The tree read, and why it is one payload

`listAssistantTree` is a single `assistants LEFT JOIN topics` filtered by
`ownerId`, grouped in memory with the same `Map` shape as
`listProviderConfigs` (`provider.service.ts:169`). Assistants sort by
`createdAt` ascending (stable, newest last); topics sort by `createdAt`
descending (newest conversation first, per D9).

```ts
type AssistantTree = { assistants: Assistant[] };
type Assistant = {
  id; name; icon;
  systemPrompt: string | null;
  defaultProviderConfigId: string | null;
  defaultModelId: string | null;
  topics: Topic[];                    // { id, title, createdAt }
};
```

One nested payload rather than `GET /api/assistants` plus a per-expansion
`GET /api/topics?assistantId=`:

- D2 opens the active topic's assistant pane on load. Lazy loading would make
  that two serial round-trips before the sidebar can paint its most important
  row.
- D8's confirmation must state a topic count. `topics.length` on the same
  payload that drew the tree cannot disagree with what the user is looking at;
  a separately fetched count can.
- Expanding any other group becomes pure client work, no spinner.

Accepted cost: payload grows with total topics. D9 already declared phase 1
un-optimised for topic count, and the same nesting is trivially replaceable with
lazy children later without changing the sidebar's component shape.
Loading uses fixed-width `Skeleton` rows rather than `SidebarMenuSkeleton`,
whose `Math.random` widths mismatch between server and client.

### The lazy seed

```ts
const rows = await selectTree(actor);
if (rows.length > 0) return group(rows);

await db.insert(assistants)
  .values({ id: newId(), ownerId: actor.userId,
            name: DEFAULT_ASSISTANT_NAME, icon: DEFAULT_ASSISTANT_ICON })
  .onConflictDoNothing();

return group(await selectTree(actor));   // both racers converge here
```

`onConflictDoNothing` over `try/catch isUniqueViolation`: the conflict is an
expected outcome of a benign race, not an error worth constructing. The
unconditional re-read is what makes the loser correct rather than empty.

`DEFAULT_ASSISTANT_NAME` / `DEFAULT_ASSISTANT_ICON` / `DEFAULT_TOPIC_TITLE` live
in `src/lib/schemas/…` (isomorphic, no `server-only`) so
`08-31-chat-streaming` can import `DEFAULT_TOPIC_TITLE` to distinguish an
untouched title from a user-edited one — the reason D9 skipped a
`title_set_by_user` column.

With D12 the seed fires **exactly once per account**: nothing else can take the
count back to zero, so this is a first-paint path only.

### Deleting an assistant

D12 makes this the one operation in the task that needs a transaction. The check
"is this the last one" and the delete itself must not be separable, or two
concurrent deletes each see two rows and both proceed.

```ts
await db.transaction(async (tx) => {
  const owned = await tx
    .select({ id: assistants.id })
    .from(assistants)
    .where(eq(assistants.ownerId, actor.userId))
    .for("update");                       // serialises concurrent deletes

  if (!owned.some((row) => row.id === id)) {
    throw new AppError("NOT_FOUND", 404, "Assistant not found");
  }
  if (owned.length <= 1) {
    throw new AppError("CONFLICT", 409, "Cannot delete your only assistant");
  }

  await tx.delete(assistants).where(eq(assistants.id, id));   // cascades to topics
});
```

Notes:

- `FOR UPDATE` locks every assistant row the actor owns, so the second
  transaction blocks until the first commits and then re-reads a count of one.
  Row-level locking on rows the actor alone can touch means no cross-user
  contention.
- Ownership is still decided inside the statement set, not by a fetch-then-check
  in application code: the locked `SELECT` is already filtered by `ownerId`, so a
  foreign id simply is not in `owned` and yields `NOT_FOUND` — indistinguishable
  from a nonexistent id, per `error-handling.md:72`.
- The order matters: `NOT_FOUND` is decided before `CONFLICT`, so probing another
  user's assistant never reveals how many assistants they have.
- `CONFLICT` is thrown before any topic row is touched (PRD R6a). The cascade is
  still the database's job (`onDelete: "cascade"`), not a manual delete of
  children.
- `setup.service.ts` is the existing precedent for `db.transaction()` in this
  codebase; this is the second use, not a new pattern.

`deleteTopic` needs none of this — a topic has no floor.

### Ownership, per operation

| Operation | Filter |
|---|---|
| tree read | `assistants.ownerId = actor.userId` |
| assistant update | `and(eq(assistants.id, id), eq(assistants.ownerId, actor.userId))`, zero rows → `NOT_FOUND` |
| assistant delete | the locked `ownerId`-filtered select above; id absent → `NOT_FOUND`, count ≤ 1 → `CONFLICT` |
| topic create | `requireOwnedAssistant(input.assistantId, actor)` first; the insert uses the *validated* row's id |
| topic rename/delete/read | `topics.id = id` joined to `assistants.ownerId = actor.userId` |

Topic mutations resolve the parent before touching the child and never trust an
`assistantId` from the body — the rule `provider.service.ts:341` already
follows. Since Postgres cannot `UPDATE … JOIN`, rename/delete use a subquery on
the owned-assistant id set, keeping the filter inside the statement rather than
fetching the row and checking in TypeScript.

## Transport

| Method | Path | Status | Body |
|---|---|---|---|
| GET | `/api/assistants` | 200 | `{ assistants: [...] }` (may have seeded) |
| POST | `/api/assistants` | 201 | the assistant, `topics: []` |
| PATCH | `/api/assistants/[id]` | 200 | the assistant |
| DELETE | `/api/assistants/[id]` | 204 | — |
| POST | `/api/topics` | 201 | the topic |
| PATCH | `/api/topics/[id]` | 200 | the topic |
| DELETE | `/api/topics/[id]` | 204 | — |

`requireActor(request.headers)` on all seven; `withErrorHandling` wrapping all
seven; four-line handlers. No `requireAdmin` — every row is owner-scoped and
D7 removed sharing entirely.

There is no `GET /api/topics/[id]`. Its only would-be caller is the RSC page,
which calls `findTopicForActor` directly, and `08-31-chat-streaming` will need a
topic-with-messages read whose shape it should define itself. `TSD-D2` rule 1
(the upstream tech-stack decision, not this task's D2) requires every
*capability* to have a Route Handler; rendering a page is not a capability, and
shipping an endpoint with no client is the pattern D3/D9 keep rejecting.

## UI

### Sidebar

`AppSidebar.tsx` stays a Server Component. Header and list both live inside
`AssistantTree` (`"use client"`) so the chrome can swap with the pane:

```tsx
<Sidebar>
  <AssistantTree />          {/* header + content; replaces New chat + EmptyState */}
  <SidebarFooter>…</SidebarFooter>
</Sidebar>
```

`AssistantTree`:

- `useAssistantTree()` — one `useQuery` on `assistantKeys.tree()`.
- Active topic from `useParams()`. On `/t/[topicId]` it yields `topicId`; on
  `/settings/*` it yields nothing. The default open pane is
  `assistants.find(a => a.topics.some(t => t.id === topicId))`. A local
  `'list' | assistantId | null` override lets Back show the assistant list
  without changing the URL (AC12). Not Zustand.
- Level 1: assistant rows (name + icon, no trailing actions) and New
  assistant. No New chat.
- Level 2: back arrow, assistant name, New topic, Profile (opens the editor),
  and that assistant's topics. Assistant delete is a disabled-or-enabled
  icon on the Profile row (D12, AC10c) — no extra copy.
- Topics render as `SidebarMenu` / `SidebarMenuItem` with `SidebarNavLink` to
  `/t/[id]` — reusing the existing link component means the mobile drawer keeps
  closing on navigation (AC14) with no new code. `SidebarMenuAction` opens
  rename / delete.
- Loading: three fixed-width `Skeleton` rows. An assistant with no topics: the
  existing `EmptyState`.

The static `Topics` group label belongs on level 2 only.

### Dialogs

`AssistantEditorDialog` handles both create and edit (same four fields, D3):
`Input` name, an emoji `Input`, `Textarea` system prompt, and a model `Select`
whose options come from `useAvailableModels()`. Each option's label carries
provenance — own config name, or shared plus owner name — because F4's contract
exists to make whose-quota visible. A stored pair absent from the available set
renders as an explicit unavailable notice with nothing preselected (R4/D11), and
saving with no model stays legal (D6).

`DeleteAssistantDialog` is an `AlertDialog` stating the assistant name and its
exact topic count from the cached tree. The last-assistant Delete item is
disabled, so the dialog is only reachable when a second assistant exists
(D12); should the 409 still arrive — a stale tree, or a second tab that
deleted the other assistant first — it renders through `apiErrorMessage` like
any other mutation failure.
`RenameTopicDialog` is a `Dialog` with one `Input`. Topic delete reuses
`AlertDialog`.

### Query keys and invalidation

```ts
assistantKeys = { all: ["assistants"], tree: () => [...assistantKeys.all, "tree"] }
availableModelKeys = { all: ["available-models"] }
```

Every assistant *and* topic mutation invalidates `assistantKeys.all`, because
both live in the one tree payload. Nothing here invalidates
`available-models` — this task never edits a provider config; the reverse
direction (a provider mutation changing availability) is already handled by
`08-31-providers`' own invalidation.

`listAvailableModels()` goes into `src/lib/api/provider.ts` and its hook into
`src/components/provider/use-available-models.ts`, following the data's domain
rather than its first consumer: the contract already lives in
`lib/schemas/provider.ts:61`, and `08-31-chat-streaming`'s model picker becomes
the second consumer with nothing to move.

### Topic page

`(app)/t/[topicId]/page.tsx` — Server Component: `resolveActor(await headers())`,
`findTopicForActor`, `notFound()` when null, then `PageContainer` +
`PageHeader title={topic.title}` + `EmptyState` explaining messaging is not
available yet. Same composition as `(app)/page.tsx:6-13`, so `08-31-chat-streaming`
replaces one `EmptyState` with the message list and composer.

## Testing

| Level | File | Covers |
|---|---|---|
| Integration | `src/server/services/assistant.service.integration.test.ts` | AC2, AC3, AC4, AC5, AC6 (persistence half), AC10 cascade, AC10a, AC10b |
| Integration | `src/server/services/topic.service.integration.test.ts` | AC8, AC9, plus cross-user 404 on rename/delete/read |
| Integration | `src/server/services/assistant-model-reference.integration.test.ts` | AC7's data half: deleting a provider config nulls `default_provider_config_id` and the assistant still loads |
| Component | `src/components/assistant/AssistantTree.test.tsx` | AC11, AC12 — group per assistant, only the active topic's group expanded; AC10c — delete disabled at one assistant, enabled at two |
| Component | `src/components/assistant/AssistantEditorDialog.test.tsx` | AC6/AC7 UI half — provenance in options, unavailable notice, saveable with no model |

`beforeEach` in each integration file deletes `topics`, `assistants`, then the
provider and auth tables, extending the existing `resetState` shape
(`provider.service.integration.test.ts:65`). Users of each role come from
`src/server/auth/auth-test-helpers.ts`.

AC4's race is exercised with `Promise.all([listAssistantTree(a), listAssistantTree(a)])`
against the real database — the only way `onConflictDoNothing` and the re-read
are actually proven. AC10b's race is the mirror image:
`Promise.allSettled([deleteAssistant(x, a), deleteAssistant(y, a)])` over an
actor with exactly two assistants, asserting one row survives and that the
failure is a `CONFLICT`, not a deadlock or a timeout. Note
`fileParallelism: false` for the integration project, so both are deliberate
in-file concurrency, not cross-file.

AC1 (migration on an empty database), AC13, AC14, AC15, and AC16 are manual
verification steps, listed in `implement.md`.

## Trade-offs and risks

- **The last assistant is a floor, and the floor needs a lock.** D12 turns
  delete into the task's only transactional operation. The residual risk is not
  correctness but contention: `FOR UPDATE` over an actor's own rows can only ever
  block that actor's other in-flight delete, so the blast radius is one user's
  two simultaneous clicks. Verify at implement time that Drizzle's `.for("update")`
  emits the lock inside the same transaction — if it silently no-ops, AC10b
  fails and the fallback is an explicit `SELECT … FOR UPDATE` via `sql`.
- **An account can never reach zero assistants** (D12). A user wanting a clean
  slate must edit the one they have. If that ever becomes a real complaint, the
  fix is a "reset assistant" action, not lifting the floor — lifting it brings
  back D5's regenerating-assistant confusion.
- **The tree is one payload.** Fine at phase-1 scale, and D9 already accepted
  no optimisation for topic count. The swap to lazy children is contained to
  `use-assistants.ts` and one route.
- **A partially-null model pair** is reachable via the FK's `set null`. Harmless
  because the read contract requires both, but it will look odd in a database
  dump.
- **`useParams()` in a component rendered from a layout.** Verify at implement
  time that it returns `topicId` on `/t/[topicId]` and an empty object on
  `/settings/*`. If it does not, `usePathname()` with a prefix match is the
  fallback; both are derivation, so AC12 holds either way.
- **Four new `components/ui/` files.** `08-31-app-shell`'s
  `research/shadcn-sidebar-primitive.md:65` recorded that the registry leaks an
  `@/app/(create)/…` import which the CLI is expected to rewrite. Check all four
  generated files for that path before committing (AC16).
- **Emoji as a plain text column.** Nothing validates that `icon` holds exactly
  one emoji; a user can paste a sentence and stretch the sidebar label. A Zod
  `max(8)` bound keeps the damage cosmetic without pretending to parse
  grapheme clusters.
