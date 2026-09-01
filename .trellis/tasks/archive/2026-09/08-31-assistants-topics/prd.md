# Assistants and Topics

## Goal

A signed-in user organises their conversations under assistants. An assistant
is a private, named configuration — emoji, system prompt, default model — and
every conversation ("topic") belongs to exactly one. The sidebar becomes a
two-level drill-down over that structure: the assistant list, then one
assistant's topics.

This task owns that data model, its CRUD, and the sidebar navigation. It does
not send, stream, or persist a single chat message — `08-31-chat-streaming`
does. It is the second of the two consumers `08-31-providers` R7 named for
`resolveAvailableModels`.

## Background

### Source requirement

The only first-hand statement of scope for this feature is six words inside the
original project brief:

> 这个项目是一个用户自部署的AI聊天网站。首期功能将聚焦在文本聊天，需要实现PC端和移动端的
> 布局、配置供应商和模型、**新建助手和话题**、简单的用户管理等基础功能。

No reference product was ever named by the user. Cherry Studio, LobeChat, and
Open WebUI appear in the task history only as AI-introduced analogies —
LobeChat/Open WebUI as *architecture* comparisons in TSD-D1,
Cherry Studio as a *rejected layout* in
`08-31-app-shell` D-IA-1. None of them is a product-shape decision, so every
decision below was taken with the user in this planning session.

### Decided upstream — do not relitigate

`TSD` below means
`archive/2026-08/00-bootstrap-guidelines/research/tech-stack-decision.md`, whose
own decisions are also numbered `D…`. `TSD-D4` is its provider-visibility
decision; an unprefixed `D4` is this document's message-table decision.

| Constraint | Source |
|---|---|
| Every capability is an HTTP Route Handler; no Server-Action-only paths | TSD-D2 rule 1 (`TSD:57`) |
| Services take `(input, actor)` and never mention Next.js | `.trellis/spec/backend/directory-structure.md:53` |
| Ownership isolation is a `WHERE` clause; a row failing it is `NOT_FOUND`, never `FORBIDDEN` | `.trellis/spec/backend/database-guidelines.md:69`, `error-handling.md:72` |
| `text` UUIDv7 primary keys, `timestamptz`, `snake_case` plural tables, `pgEnum` over free text | `.trellis/spec/backend/database-guidelines.md:24` |
| Model availability comes from exactly one resolution function — assistant defaults must call it, not re-query | TSD-D4 rule 2, `.trellis/spec/backend/database-guidelines.md:113` |
| Server state is TanStack Query, never mirrored into Zustand; the current topic id is URL state; derive before storing | `.trellis/spec/frontend/state-management.md:12`, `:36` |
| Two-column shell, one sidebar plus content; one component tree at both breakpoints | `08-31-app-shell` D-IA-1, R2 |
| Cascading deletes on message data require an explicit product decision | `.trellis/spec/backend/database-guidelines.md:165` |
| `components/ui/` is generated territory — wrap, never hand-edit | `.trellis/spec/frontend/directory-structure.md:52` |

### Confirmed facts — read from the repo, not recalled

**F1 — There is no assistant, topic, or message anything.** No schema file, no
service, no route, no Zod contract, no component directory, no `src/stores/`.
The only traces are two empty states: `AppSidebar.tsx:45-52` renders
`<EmptyState title="No topics yet">` under a `Topics` group label, and
`(app)/page.tsx:9-12` renders "Nothing to send yet".

**F2 — The sidebar has a topic region and no assistant region.**
`src/components/layout/AppSidebar.tsx:28-63` is `SidebarHeader` (product name +
a "New chat" link) + `SidebarContent` (one `SidebarGroup` labelled `Topics`) +
`SidebarFooter` (`SidebarUserMenu`). It is a Server Component; `(app)/layout.tsx`
resolves the actor and passes identity down as props. `08-31-app-shell` R3
committed to "a list region for topics" only and deferred the assistant
switcher:

> Rejected: a three-column Cherry Studio layout … It reserves room for an
> always-visible assistant switcher … **Revisit if an always-visible assistant
> switcher becomes a requirement.** (`archive/2026-09/08-31-app-shell/prd.md:86`)

So this task inherits an unanswered IA question, not a reserved slot.

**F3 — The empty states are contracted deliverables, not scaffolding.**
`08-31-app-shell` D-EMPTY-1 calls them "real work that `assistants-topics` and
`chat-streaming` will keep and feed data into", and logged the debt this task
inherits: "the list region's overflow and scroll behaviour under many items is
not exercised until topics land".

**F4 — The model-availability contract this task must consume already ships.**
`resolveAvailableModels(actor)` in `src/server/ai/model-resolution.ts` returns
`{ configId, configName, modelId, provenance: "own" | "shared", ownerName }`,
exposed as `GET /api/models`, with the Zod contract in
`src/lib/schemas/provider.ts:61`. `08-31-providers` shipped it deliberately
without a caller and named this task as one of two required consumers
(`archive/2026-09/08-31-providers/prd.md:219`). It is a *derived* set: a shared
provider config can be deleted or un-shared after an assistant pins one of its
models.

**F5 — Every backend pattern this task needs has a working precedent in
`src/server/services/provider.service.ts`.** `(input, actor)` signatures;
ownership in the `WHERE` (`:78`); a private `requireOwnedX` helper returning
`NOT_FOUND` (`:87`); `AppError(code, status)` from `src/server/errors.ts` whose
codes are `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | VALIDATION_FAILED |
CONFLICT | RATE_LIMITED | PROVIDER_ERROR | INTERNAL`; `isUniqueViolation` from
`src/server/db/unique-violation.ts` mapped to `409` (`:242`); explicit column
projection; `logger.info` with `userId` (`:236`); parent-scoped child mutations
that never trust a child's parent id from the body (`:341`). Route Handlers are
four lines wrapped in `withErrorHandling` with `requireActor(request.headers)`;
POST returns `201`, DELETE returns `204`.

**F6 — Every frontend pattern likewise.** `src/components/provider/` holds the
screen plus `use-provider-configs.ts` (a `providerConfigKeys` factory, one
`useQuery`, mutations that all `invalidateQueries` on the key root);
`src/lib/api/provider.ts` holds the typed fetch client with shared
`parseJson` / `parseEmpty` helpers that Zod-parse responses and throw the raw
error body, which `apiErrorMessage` (`src/lib/api/error-message.ts`) renders.

**F7 — The UI primitives are thin.** `src/components/ui/` has 10: `button`,
`dropdown-menu`, `input`, `label`, `select`, `separator`, `sheet`, `sidebar`,
`skeleton`, `tooltip`. Missing and needed here: `collapsible`, `dialog`,
`alert-dialog`, `textarea`.

`src/components/ui/sidebar.tsx` already exports what two-level navigation
needs: `SidebarMenuSub` / `SidebarMenuSubItem` / `SidebarMenuSubButton`,
`SidebarGroupAction` (a group-level action button), `SidebarMenuAction` (a
per-row action), `SidebarMenuBadge`, and `SidebarMenuSkeleton`.

**F8 — There is no destructive-action confirmation anywhere in the repo.**
`ProviderConfigsScreen.tsx:161` deletes a provider config on a single click with
no confirmation; `AdminUsersScreen.tsx:120` still uses `window.prompt`, a defect
`08-31-app-shell` D-RESTYLE-1 knowingly left in place.

**F9 — Testing is three Vitest projects** (`vitest.config.mts:13-48`):
`unit-node`, `unit-dom` (jsdom), and `integration` (`*.integration.test.ts`,
serial, real Postgres from `TEST_DATABASE_URL`, migrations in `globalSetup`,
per-file `beforeEach` DELETE — `provider.service.integration.test.ts:65`).
Helpers for seeding users of each role are in
`src/server/auth/auth-test-helpers.ts`. Gates: `pnpm lint`, `pnpm typecheck`,
`pnpm test`. Latest migration is `0004`.

**F10 — The spec pre-committed this task's file layout and one data shape,
both unreviewed.** Layout, which reviewers will read as a contract:
`api/assistants/` and `api/topics/` as siblings
(`backend/directory-structure.md:19`), `schema/topic.ts`, `topic.service.ts`,
`createTopicSchema` / `CreateTopicInput` (`:107`), `components/assistant/` and
`components/topic/` as siblings, `(app)/t/[topicId]/page.tsx` as a top-level
route, `lib/api/topics.ts`, `use-topic-list.ts`
(`frontend/directory-structure.md:19`).

Data shape, contradicted by D1 below: `frontend/type-safety.md:24` illustrates
Zod contract sharing with `topicSchema` carrying
`assistantId: z.string().nullable()`.

**F11 — Message-table ownership was contradicted across two archived
artifacts**, resolved by D4. `archive/2026-08/08-31-scaffold/design.md:50` — a
document the user approved — says "topics and messages by `assistants-topics`".
`08-31-chat-streaming/task.json` says "server-authoritative message
persistence". The hard constraint (TSD-D2 rule 4) fixes the source of truth, not
the owning task.

## Decisions

**D1 — The assistant is a first-class grouping that owns its topics.** Every
topic belongs to exactly one assistant; `assistant_id` is `NOT NULL`. Chosen by
the user over an optional preset a topic may point at, and over a create-time
template snapshotted into the topic. This is the Cherry Studio / LobeChat
organising model: a user picks an assistant to see that assistant's
conversations.

Two prior AI-authored assumptions are overridden and must be reconciled in
Phase 3.3: `frontend/type-safety.md:24`'s nullable `assistantId` (F10) becomes
non-nullable, and `08-31-app-shell`'s deferral of the assistant switcher (F2)
becomes this task's work.

**D2 — The sidebar is a LobeChat-style drill-down, not a collapsible tree.**
Level 1 is the assistant list. Choosing an assistant replaces the sidebar with
that assistant's pane: a back arrow, the assistant name, New topic, Profile
(the editor), and that assistant's topics. The back arrow returns to the
assistant list without changing the open conversation. There is no "New chat"
control on level 1.

This supersedes the earlier collapsible-group layout. The user chose drill-down
over collapsing every assistant in one scrolling column, and over a vertically
split two-pane sidebar.

Consequences:

- **Pane state is local `useState`, not Zustand.** Defaulting the open pane
  from the active topic still satisfies "derive before storing"
  (`state-management.md:36`). The override exists because Back must be able to
  show the assistant list while `/t/[topicId]` stays put — that fact cannot be
  derived from the URL. It lives in `AssistantTree` only
  (`state-management.md` step 4: one-subtree ephemeral UI). `src/stores/`
  remains absent.
- **The flat route survives.** `(app)/t/[topicId]` (F10) stays as specced; no
  `/a/[assistantId]` segment is introduced. Landing on an assistant with no
  topics is a sidebar pane, not a route.
- **No nested in-drawer navigation.** The mobile drawer still hosts one
  sidebar tree; drill-down swaps its contents. `08-31-app-shell` R2 holds.
- Assistant rows on level 1 have no trailing action icons. New topic, Profile,
  and per-topic actions live on level 2, so the overlapping `SidebarGroupAction`
  pair from the collapsible layout does not return.

Accepted cost: "which assistant am I in" is now a pane rather than a derived
expansion, so a refresh while on a topic re-enters that assistant's pane.

**D3 — An assistant is name + emoji icon + system prompt + default model.** No
generation parameters, no description. Chosen by the user over a
parameter-carrying assistant and over a prompt-less grouping container.

Three of the four are forced rather than chosen: the name is the level-2 pane
header (D2), the system prompt is the only thing separating an assistant from
a folder, and the default model is the binding F4 requires.

Parameters (`temperature`, `top_p`, max tokens, context window size) are
deferred to `08-31-chat-streaming` on the standard set by `08-31-providers` P1:
phase-1 chat is plain text, this task never calls `streamText`, so the columns
would have exactly one reader and that reader is a task that may well choose the
AI SDK defaults. Adding them later is a purely additive migration. The emoji
passes the same test because it has a reader here — the sidebar group label.

Accepted cost: a phase-1 assistant is tunable only through its prompt, so
"creative vs. precise" presets are not expressible until the next task.

**D4 — This task creates `assistants` and `topics` only. The message table
belongs to `08-31-chat-streaming`.** Chosen by the user, resolving F11 in favour
of the sibling task's description.

The message table's shape is downstream of the streaming implementation —
whether `ai@7`'s `UIMessage.parts` is one `jsonb` column or a child table,
whether `role` is a `pgEnum`, whether `metadata` exists — and only the task
writing `streamText`'s `onFinish` can settle it. `08-31-providers` shipped
`GET /api/models` without a caller, but that had TSD-D4 rule 2 (stop two queries
from drifting) behind it; a message table has one writer and no drift risk, so
the precedent does not extend.

Accepted cost: the `assistant → topic → message` cascade chain spans two tasks,
so a reviewer must read both PRDs to see it whole.

**D5 — The first assistant is created lazily, on the first read that finds
none.** Chosen by the user over a guided create-your-first-assistant screen and
over seeding at registration.

Consequences to implement deliberately:

- The list read performs a write when the actor has no assistants. It is
  idempotent in its result, not in its effect.
- Concurrent first-paint requests can race. A `(owner_id, name)` unique index —
  the pattern already proven by `provider_configs_owner_name_uidx` — plus
  `isUniqueViolation` (F5) makes the loser re-read instead of failing.
- The seeded row has no default model (D6), no system prompt, and a name and
  emoji this task invents.
- This is a deliberate departure from `08-31-app-shell` D-EMPTY-1 ("real empty
  states, no fake data"): a "no assistants" empty state can now never render,
  because the list is never empty — and with D12 deletion cannot empty it
  either. The "no topics in this assistant" empty state still does, so
  `AppSidebar.tsx:48` keeps a purpose.
- With D12 in place the seed fires exactly once per account, so the race below
  is a first-paint concern only, not a recurring one.

**D6 — An assistant's default model is nullable.** Derived, not chosen: a
freshly registered user has no provider config, so `resolveAvailableModels`
returns an empty set and there is nothing for D5's seeded assistant to point at.
The same nullability absorbs a provider config later deleted or un-shared (D11).
Stored as two nullable columns — provider config id and model id — because F4's
contract is keyed on both.

**D7 — Assistants are always private. No `visibility` column.** Chosen by the
user over instance-wide sharing and over a copy-someone-else's-assistant
template flow.

TSD-D4's sharing mechanism exists because credentials cost money — without
sharing, every user needs their own API key. An assistant costs one form
submission, so sharing buys little. Under D1 it also costs a lot: a provider
config is a
*resource* consumers merely spend, whereas an assistant *owns topics*. Sharing a
container crosses ownership — someone else's topics would hang off your
assistant, your deletion would orphan rows whose `assistant_id` is `NOT NULL`,
and your prompt edit would silently change a conversation you cannot see.

Accepted cost: no prompt-reuse mechanism exists on the instance. A tuned
assistant can only be described to a colleague, not distributed. The natural
later move is the copy-a-template option, which keeps ownership un-crossed.

**D8 — Deleting an assistant cascades to its topics, behind a confirmation
dialog that states how many topics will be destroyed.** Chosen by the user over
refusing to delete a non-empty assistant and over migrating its topics
elsewhere. This is the explicit product decision
`database-guidelines.md:165` requires, and it extends through
`08-31-chat-streaming`: once that task adds `topic_id` with a cascade, one
confirmation destroys an assistant's entire message history.

Refusing to delete was rejected as false safety — a user who wants the assistant
gone deletes its topics first and loses the same data through a more tedious
path; its only real value is guarding against a misclick, which the dialog
covers. This makes the task the first place in the repo with a real destructive
confirmation (F8).

Accepted cost: one confirmed click permanently destroys conversation history.
Phase 1 has no trash, no undo, and no export.

**D9 — Topics support create, rename, and delete. Nothing else.** Chosen by the
user over adding pinning, and over adding pinning plus search plus
cross-assistant moves.

Rename is not optional: D4 leaves this task without a message table, so
auto-titling from the first message is technically impossible and belongs to
`08-31-chat-streaming`. This task creates topics with an invented default title,
and rename is the only way a title can change.

Pin, search, and folders were cut on one shared argument: their value scales
with topic count, and phase 1 launches with zero topics per user. Folders are
also redundant — D1 already made the assistant the grouping dimension, so
folders would be a third navigation level in one sidebar column. No
`title_set_by_user` column is reserved for the future auto-titler either:
`chat-streaming` can compare against the exported default-title constant, so the
column would have no reader here — the same D3 test.

Accepted cost: the topic list is flat reverse-chronological with no pinning and
no search, so a user with dozens of topics under one assistant can only scroll.
This confirms `08-31-app-shell`'s logged overflow debt (F3) goes unpaid in
phase 1. A topic created under the wrong assistant can only be deleted and
recreated.

**D10 — Assistants are created and edited in a dialog opened from the sidebar
row.** Chosen by the user over a `/settings/assistants` page and over a
dedicated route.

D3 leaves only four fields, which a dialog holds comfortably, and D2 already
made the sidebar the single entry point — a settings page would split navigation
and management across two places for one entity, for an operation far more
frequent than editing a provider config. A dedicated route would also weaken
D2's argument that no `/a/[assistantId]` segment is needed.

Accepted cost: editing a long system prompt in a dialog on mobile is cramped,
with the virtual keyboard covering much of the screen. A full-page settings form
would be better in exactly that case.

**D11 — A stale default model is surfaced lazily, in the assistant editor.** Not
put to the user: silently falling back to another available model was excluded
because it spends someone else's quota without consent, and flagging staleness in
the sidebar would add a cross-check query to every render of a component that
renders on every page load, for a rare condition. The editor cross-checks the
stored pair against `resolveAvailableModels` (F4) and, when absent, shows the
model as unavailable with nothing preselected. Warning at send time belongs to
`08-31-chat-streaming`.

**D12 — An actor's last assistant cannot be deleted.** Added by the user after
reviewing the plan, and it changes two earlier decisions rather than sitting
beside them.

It removes D5's strangest consequence. Without D12, deleting your only assistant
makes a fresh empty one appear on the next read — correct per D5, but it reads
as "the assistant came back". With D12 the assistant count never returns to
zero after the first read, so the lazy seed fires exactly once in an account's
lifetime.

It also narrows D8: the cascade stands, but the delete is refused outright when
the assistant is the last one, before any topic is touched.

Shape of the rule:

- **Enforced in the service, not only in the UI.** The Route Handler receives
  arbitrary JSON, so a disabled menu item is not enforcement — the same
  reasoning `database-guidelines.md:107` applies to provider visibility. Unlike
  visibility, this is a rejection rather than a coercion: there is no weaker
  version of "delete" to silently substitute.
- **`CONFLICT` / `409`**, matching the code already used for a duplicate name
  (F5). It is a state conflict — the request is well-formed and authorised, but
  the resource's current state forbids it — not a validation or permission
  failure.
- **The count and the delete must be atomic.** Two concurrent deletes could each
  see two assistants and each proceed, landing on zero. The check therefore runs
  inside a transaction that locks the actor's assistant rows.
  `setup.service.ts` already establishes `db.transaction()` in this codebase.
  D5's lazy seed remains a second line of defence: even if the count were ever
  evaded, the next read produces a fresh assistant rather than an unusable
  account.
- **The UI disables the delete affordance** when the actor has exactly one
  assistant. The item stays labelled "Delete"; it does not add an explanation.

Accepted cost: an account can never reach zero assistants. A user who wants a
clean slate edits the assistant they have — renaming it and clearing its prompt —
instead of deleting and recreating it.

## Requirements

**R1 — Assistant CRUD.** A signed-in user can create, list, update, and delete
their own assistants. Fields per D3: name, emoji icon, system prompt, default
model (nullable per D6). Ownership is a `WHERE` filter on every operation; a
row that fails it is `NOT_FOUND`.

**R2 — Lazy first assistant.** A read that finds no assistant for the actor
creates one and returns it, with a name and emoji chosen by this task, no system
prompt, and no default model. Concurrent reads converge on one row rather than
erroring (D5).

**R3 — The model picker consumes the single resolution function.** The
assistant editor offers exactly the models `resolveAvailableModels(actor)`
returns, each showing its provenance — own config or shared, and whose — so the
user can tell whose quota a choice spends. No second availability query exists
anywhere in this task (F4, TSD-D4 rule 2).

**R4 — A stored model reference outside the available set reads as
unavailable** in the editor, with nothing preselected, and the assistant remains
saveable with no model at all (D6, D11).

**R5 — Topic create, rename, delete.** Creating a topic requires an assistant
the actor owns and applies the exported default title. Renaming and deleting are
owner-scoped. Ownership is reached through the parent assistant, never trusted
from the request body (D9, F5).

**R6 — Deleting an assistant destroys its topics, behind a confirmation that
states the count.** The count comes from the same payload that renders the
sidebar, so the dialog cannot show a stale number for a tree the user is looking
at (D8).

**R6a — The last assistant cannot be deleted.** The service refuses with
`CONFLICT` before touching any topic, deciding the count atomically with the
delete. The UI disables the delete affordance when only one assistant exists;
the label stays "Delete" (D12).

**R7 — Two-level sidebar.** Level 1 lists assistants and a create affordance.
Choosing an assistant opens level 2 in the same sidebar: back, the assistant
name, New topic, Profile, and that assistant's topics. The pane holding the
active topic opens on load; Back returns to level 1. Each topic row offers
rename and delete; assistant delete is an icon on the Profile row and is
disabled when the actor has one assistant. Loading uses fixed-width `Skeleton`
rows, not `SidebarMenuSkeleton` (`Math.random` widths hydrate inconsistently).
An assistant with no topics renders an empty state. Level 1 has no New chat
control (D2, D5, F7).

**R8 — Assistant editor dialog.** Reachable from Profile on the assistant pane
for editing and from New assistant on the list for a new assistant. Carries the
four D3 fields with the R3 model picker (D10).

**R9 — Topic route.** `(app)/t/[topicId]` exists, resolves the topic for the
actor, renders its title, and renders an empty state explaining that messaging
is not available yet. A topic id the actor does not own renders a not-found, not
someone else's title. This is not a placeholder route — the topic is real and
owned by this task; only its message area is empty (F3, D4).

**R10 — Both breakpoints, one tree.** The sidebar tree, its actions, the
editor dialog, and the confirmation dialog are all usable at desktop and mobile
widths, with the mobile drawer closing after navigating into a topic. Icon-only
controls carry accessible names (`08-31-app-shell` R2, R10).

**R11 — New primitives are added by the CLI, not hand-written.** `dialog`,
`alert-dialog`, and `textarea` enter through `shadcn add` into
`components/ui/`, unedited (F7, `frontend/directory-structure.md:52`).

## Acceptance Criteria

- [ ] **AC1** Migration `0005` applies cleanly to an empty database and creates
      `assistants` and `topics` with `snake_case` plural names, `text` UUIDv7
      primary keys, and `timestamptz` timestamps. `topics.assistant_id` is
      `NOT NULL`. No message table is created. (R1, R5, D1, D4)
- [ ] **AC2** Assistant create, list, update, and delete each work for the
      owner, and each of update/delete against another user's assistant returns
      `404` with the ownership filter in the `WHERE` clause — verified against
      the service, not the UI. (R1)
- [ ] **AC3** A user with no assistants gets exactly one back from the list
      call, persisted, with a null default model and no system prompt; calling
      the list twice does not produce two rows. (R2, D5, D6)
- [ ] **AC4** Two concurrent list calls for a user with no assistants yield one
      row total and neither call errors. (R2, D5)
- [ ] **AC5** Creating a second assistant with an existing name returns `409`,
      not `500`. (R1, F5)
- [ ] **AC6** An assistant can be saved with no default model, and with a model
      drawn from `resolveAvailableModels`; grepping this task's diff finds no
      availability query other than a call to `resolveAvailableModels`. (R3, R4)
- [ ] **AC7** After the provider config backing an assistant's default model is
      deleted, the editor shows the model as unavailable with nothing
      preselected, and the assistant still loads and saves. (R4, D11)
- [ ] **AC8** Creating a topic under an assistant the actor does not own returns
      `404`, and the `assistant_id` is taken from the validated parent lookup
      rather than trusted from the body. (R5)
- [ ] **AC9** A topic is created with the exported default title, can be
      renamed, and can be deleted. The default-title constant is exported for
      `08-31-chat-streaming` to compare against. (R5, D9)
- [ ] **AC10** Deleting an assistant deletes its topics; the confirmation states
      the exact topic count for that assistant; cancelling deletes nothing.
      (R6, D8)
- [ ] **AC10a** Deleting an actor's only assistant returns `409` and leaves both
      the assistant and its topics intact — verified against the service, not
      the UI. With two assistants, deleting one succeeds and the survivor is
      then itself undeletable. (R6a, D12)
- [ ] **AC10b** Two concurrent deletes issued against an actor's only two
      assistants leave at least one assistant in the database. (R6a, D12)
- [ ] **AC10c** The sidebar's delete affordance is disabled, labelled "Delete"
      with no extra copy, when the actor has exactly one assistant. (R6a, D12)
- [ ] **AC11** The sidebar lists assistants on level 1; opening an assistant
      (or loading a topic) replaces it with that assistant's pane and hides
      the other assistants. Back returns to the list. (R7, D2)
- [ ] **AC12** The open pane is `useState` inside `AssistantTree`, defaulted
      from the active topic; `src/stores/` still does not exist. (R7, D2,
      `state-management.md:36`)
- [ ] **AC13** `(app)/t/[topicId]` renders the topic's title plus a
      messaging-not-available empty state for the owner, and a not-found for a
      topic owned by someone else. (R9)
- [ ] **AC14** At a mobile width the sidebar tree, the assistant editor, and the
      delete confirmation are all usable, and the drawer closes after navigating
      into a topic. (R10)
- [ ] **AC15** Every icon-only sidebar control has an accessible name and is
      keyboard reachable with a visible focus ring. (R10)
- [ ] **AC16** `components/ui/dialog.tsx`, `alert-dialog.tsx`, and
      `textarea.tsx` exist as CLI output with no hand-edits, and no
      `@/app/(create)/…` import survives in them. (R11)
- [ ] **AC17** `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass. (all)

## Out of Scope

- The message table, message persistence, streaming, and the composer
  (`08-31-chat-streaming`) — D4.
- Auto-titling a topic from its first message — impossible without messages,
  D4/D9.
- Generation parameters on an assistant: temperature, top_p, max tokens, context
  window size — D3.
- Assistant description, and any avatar beyond a single emoji — D3.
- Assistant sharing, publishing, copying, import, or export — D7.
- Topic pinning, search, folders, and moving a topic between assistants — D9.
- Trash, undo, or export for a deleted assistant or topic — D8.
- A `/settings/assistants` page and an `/a/[assistantId]` route — D10, D2.
- Warning at send time about an unavailable model — `08-31-chat-streaming`, D11.
- Fixing `AdminUsersScreen`'s `window.prompt` or adding a confirmation to
  provider deletion (F8) — both belong to their own tasks; this task only adds
  confirmation where it creates the destructive action.
- Reconciling `frontend/type-safety.md:24` and `08-31-app-shell` R3 in spec —
  Phase 3.3 work, tracked by D1.
