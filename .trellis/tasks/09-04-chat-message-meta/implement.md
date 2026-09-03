# Implement — Chat page message meta info optimization

Execution order groups backend (data available) before frontend (renders it). Each step keeps the tree green: run the listed validation before moving on.

## Step 1 — Shared schema + time formatting utils

- [ ] `src/lib/schemas/chat.ts`: add `createdAt` (ISO string) and `reasoningMs` (non-negative int) optional fields to `chatMetadataSchema`.
- [ ] New `src/lib/message-time.ts`: `formatMessageAge(iso, now)`, `formatMessageExact(iso)` per design §4.4 (en-US locale, deterministic; invalid/missing → `undefined`).
- [ ] New `src/lib/message-time.test.ts`: cover each display rule (<60s, minutes, hours, ≥24h same year, ≥24h other year, exact tooltip format, invalid input).
- Validate: `pnpm test -- message-time` and `pnpm typecheck`.

## Step 2 — DB column + service + route (timestamps & reasoning duration)

- [ ] `src/server/db/schema/chat.ts`: add nullable `reasoningMs: integer("reasoning_ms")` to `chatMessages`.
- [ ] Run `pnpm db:generate` and commit the generated migration; apply locally with `pnpm db:migrate`.
- [ ] `src/server/services/message.service.ts`:
  - `metadataFromRow`: user rows → `{ createdAt }`; assistant rows → existing fields + `createdAt` + `reasoningMs`.
  - `appendAssistantMessage`: accept `reasoningMs?: number | null`, persist it.
- [ ] New `src/server/ai/reasoning-timer.ts`: `createReasoningTimer()` per design §3.2 (+ unit test `reasoning-timer.test.ts` covering start/end, answer-start end, no-reasoning, aborted-mid-thought finish fallback).
- [ ] `src/app/api/chat/route.ts`:
  - capture stream-start time (for assistant `createdAt`),
  - wire `onChunk` → timer; early-emit `reasoningMs` via `writer.write({ type: "message-metadata", ... })` registered from `execute`,
  - finish `messageMetadata` gains `createdAt` (stream start) and `reasoningMs` fallback,
  - pass `reasoningMs` into `appendAssistantMessage`.
- [ ] Update `src/server/services/message.service.test.ts` for the new metadata shape.
- Validate: `pnpm test`, `pnpm typecheck`, `pnpm lint`; manual smoke via `pnpm dev` (send a message, reload, confirm history returns `createdAt`).

Rollback point: revert the migration + route/service/schema edits as one commit-scope unit.

## Step 3 — Topic title size (R1)

- [ ] `src/components/layout/InsetHeader.tsx`: `text-lg` → `text-base`.

## Step 4 — Message meta UI (R2–R5)

- [ ] `MessageItem.tsx`:
  - add `group/message` to the `<article>`; new optional props `assistantName`, `assistantIcon` (defaults from `@/lib/schemas/assistant`);
  - assistant: header row (`emoji + name` + `MessageTimestamp` right of name) above `ReasoningBlock`; model row (`text-xs text-muted-foreground`, only when `metadata.modelId`) below status captions; actions row below model row;
  - user: `MessageTimestamp` row above the bubble (right-aligned); actions row below the bubble;
  - all hover-reveal rows use the opacity pattern from design §4.3 (always rendered, space reserved).
- [ ] New `src/components/chat/MessageTimestamp.tsx` (30s freshness interval, `<time dateTime title>`).
- [ ] New `src/components/chat/MessageActions.tsx` (copy-only row per design §4.4; clipboard mock-tested).
- [ ] `MessageList.tsx`: thread `assistantName`/`assistantIcon` down.
- [ ] `ChatView.tsx`: pass `resolvedAssistant.name`/`icon` into `MessageList`; stamp outgoing user message with `metadata: { createdAt }` in `handleSend`.
- [ ] Update `src/components/chat/MessageItem.test.tsx`: header/model/actions/timestamp presence and alignment; existing assertions survive (button name changes only where "Thought" gains a duration).

## Step 5 — Thinking duration label (R6)

- [ ] `ReasoningBlock.tsx`: new `reasoningMs?: number` prop; label `Thought (X.Xs)` when present and not streaming (`(reasoningMs / 1000).toFixed(1)`).
- [ ] `MessageItem.tsx`: pass `message.metadata?.reasoningMs` through.
- [ ] Extend `MessageItem.test.tsx`: duration rendering with/without `reasoningMs`, streaming label unaffected.

## Step 6 — Full verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] Manual pass in `pnpm dev` (desktop + narrow viewport, light + dark):
  - topic title size; assistant header on every AI reply; model id under each reply;
  - hover user message → right-aligned time above bubble + copy below bubble; hover assistant message → time right of name, copy under model row; no layout shift on hover;
  - copy writes text and flashes check; keyboard focus reveals rows;
  - relative labels (`just now`, minutes/hours) tick; title tooltip shows `yyyy-MM-dd HH:mm:ss`;
  - reasoning message shows `Thought (X.Xs)`; reload keeps duration, times, model ids.
- [ ] Dispatch `trellis-check` for the full-scope quality pass.

## Validation commands

```bash
pnpm test -- message-time reasoning-timer
pnpm test
pnpm lint
pnpm typecheck
pnpm db:generate   # only in step 2, after schema edit
pnpm db:migrate    # only in step 2
```

## Review gates

- After step 2: confirm the generated migration is the only drift (`git status` shows exactly schema + migration + touched files).
- After step 5/6: verify PRD acceptance criteria end-to-end before `trellis-check`.
