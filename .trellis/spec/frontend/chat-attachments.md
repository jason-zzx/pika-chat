# Chat Attachments (UI)

> Composer staging, attachment cards, and the client side of the file-part
> contract. Server side: [backend/chat-attachments.md](../backend/chat-attachments.md).

---

## Scenario: attaching files to a chat turn

### 1. Scope / Trigger

Cross-layer client contract: the composer emits `FileUIPart`s that the server
validates and persists, and the same parts are rendered back as attachment
cards. Chip state and warnings must be visible without hover (touch-only
clients exist), and a failed send must not lose the staged files.

Modules:

```
src/components/chat/use-composer-attachments.ts   staging + upload state machine
src/components/chat/AttachmentChip.tsx            chip (status, warnings, actions)
src/components/chat/AttachmentIcon.tsx            category icon (shared with cards)
src/components/chat/Composer.tsx                  picker/paste + chip row
src/components/chat/ChatView.tsx                  content-area drop zone (enter/leave counter + overlay)
src/components/chat/MessageItem.tsx               user-message attachment cards
src/lib/api/files.ts                              uploadChatFile / deleteChatFile / uploadChatFileDirect / listChatFiles / getFileLimits
src/hooks/use-file-limits.ts                      fileKeys factory + useFileLimits (shared by composer and usage card)
src/lib/files/media-types.ts                      classifyFile / SUPPORTED_FILE_ACCEPT / coarse list categories
src/lib/files/format.ts                           formatBytes
src/components/settings/files/                    management page: FilesScreen / UsageCard / CategoryFilter / FilesList / FilePreviewDialog / BatchDeleteDialog / use-files.ts
```

### 2. Signatures

```ts
useComposerAttachments(draftKey: string): {
  attachments: StagedAttachment[];          // bucketed in composer-store by draftKey
  addFiles(files: File[]): void;
  removeAttachment(id: string): void;
  retryAttachment(id: string): void;
  clearAttachments(key: string): void;      // after a successful send
  restoreAttachments(key: string, restored: StagedAttachment[]): void;
}

stagedAttachmentSlotCount(attachments: readonly StagedAttachment[]): number

sendMessage({ text, files })   // files: FileUIPart[] = { type:"file", url, mediaType, filename, sizeBytes }
```

`StagedAttachment` (composer-store) carries `id`, `file`, `filename`,
`mediaType`, `sizeBytes`, `status: "uploading" | "ready" | "error"`,
`error?: unknown`, `extraction?: { status, truncated }`.

### 3. Contracts

- **Upload on selection**, not on send: each accepted file immediately
  `POST /api/files`; the chip reflects `uploading → ready | error`. When
  `GET /api/files/limits` reports `directUpload: true`, the same helper instead
  runs presign → browser-to-S3 POST → complete; the chip state machine and the
  resulting message part are identical either way.
- **The size limit is runtime config.** The composer reads
  `GET /api/files/limits` through the shared `fileKeys.limits()` query cache
  (`src/hooks/use-file-limits.ts`, same cache entry as the usage card),
  pre-checks against `maxFileBytes`, and labels
  the `file.tooLarge` error with `formatBytes(maxFileBytes)`. If that fetch
  fails it falls back to `DEFAULT_FILE_LIMITS` (20 MiB, relay) — never a
  hardcoded label.
- **Slots**: `MAX_ATTACHMENTS_PER_MESSAGE` (5) counts only entries that are not
  `status: "error"` — one shared helper drives both `addFiles` and the attach
  button's `disabled` state.
- **Send**: ready chips become `FileUIPart`s; text may be empty when at least
  one ready attachment exists. Sending is blocked while any chip is
  `uploading` or `error` (no silent dropping). A failed send restores the chips
  for retry.
- **Remove**: deletes the uploaded object via `DELETE /api/files/[id]` when the
  file is not yet referenced; a `409` means it is already on a message, so the
  chip is dropped without surfacing an error.
- **Render**: user messages render file parts in part order (files precede
  text); images as `<img src={url}>` thumbnails, audio as
  `<audio controls preload="none">` and video as `<video controls preload="none">`
  (both `src={url}`, the authenticated download endpoint) above the icon +
  filename + `formatBytes(sizeBytes)` card, other files as just that card.
  Native controls are the tap path on touch clients — no hover anywhere.
  `sizeBytes` is optional — old rows render without a size. The image frame (rounded border) is drawn on the
  `<img>` itself, never on a wrapper: a shrink-wrapped container cannot track
  a replaced element capped by both `max-w` and `max-h` (its fit-content uses
  the intrinsic width), so a bordered wrapper always leaves a blank gap
  beside the rendered image.
- **Composer image chips** render the thumbnail from the uploaded
  `/api/files/<id>` URL once `status === "ready"` (spinner while uploading).
  Never create a local object URL in the chip: a `useMemo` +
  revoke-on-unmount pair tears under StrictMode's double-effect (the URL is
  revoked right after mount and the preview renders broken).
- **Links open `/api/files/<id>` in a new tab**, authenticated by the session
  cookie. Do not use `next/image` (it would proxy and resize).
- **Drop zone is inert while a turn streams**: the composer refuses input in
  flight (paperclip, textarea, drop handler), so the overlay must not appear
  either — never invite a drop that would be silently ignored. The overlay is
  decorative and `aria-hidden`; the labelled attach button is the accessible
  path.

### 4. Validation & Error Matrix

| Condition | Client behaviour |
|---|---|
| `file.size > limits.maxFileBytes` (runtime limit from `GET /api/files/limits`, 20 MiB fallback) | error chip, `file.tooLarge` with `{limit}` — does not consume a slot |
| `classifyFile()` returns null | error chip, `file.unsupportedType` — does not consume a slot |
| accepted uploads already at 5 | error chip, `file.tooMany` with `{max}` |
| upload request fails | error chip with a retry action; sending stays disabled |
| upload rejected with `QUOTA_EXCEEDED` / 413 | error chip: `AttachmentChip` resolves the envelope's `messageKey` through `apiErrorMessage`, so it renders `file.quotaExceeded` with `{used}`/`{quota}` — does not consume a slot |
| `extraction.status === "empty"` | visible "no extractable text" warning on the chip |
| `extraction.status === "failed"` | visible "cannot read file" warning on the chip |
| `extraction.truncated === true` | visible "content will be truncated" warning on the chip |
| send request fails | chips restored to the composer; error localized via `apiErrorMessageFromUnknown` |

### 5. Good / Base / Bad Cases

- **Good**: pick 3 files → chips upload in parallel → send with an empty text
  box → cards render on the message.
- **Base**: pick an oversized file → error chip with a retry/remove control and
  the attach button still enabled.
- **Bad**: hiding chip warnings behind a `title`/tooltip, or disabling the
  attach button because rejected chips filled the list. Touch clients never see
  hover, and the user is stuck until they clear chips that will never upload.

### 6. Tests Required

- `use-composer-attachments.test.tsx`: upload state transitions, rejected files
  not consuming slots, `409` on remove is swallowed, restore after failure.
- `Composer.test.tsx`: chip name + size, upload spinner, visible failure with
  retry, empty/truncated warnings, attach control enabled with rejected chips
  and disabled at five uploadable ones, paste path.
- `ChatView.test.tsx`: the content-area drop zone — overlay on file
  dragenter, enter/leave counter across children, drop routes files to
  `addFiles`, non-file drags ignored.
- `MessageItem.test.tsx`: file card with size, image thumbnail, card without
  `sizeBytes`.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Only staged entries that upload may occupy a slot.
const capReached = attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE;
```

#### Correct

```tsx
const capReached =
  stagedAttachmentSlotCount(attachments) >= MAX_ATTACHMENTS_PER_MESSAGE;
```

---

### Common Mistakes

- Reading `useChat().error?.message` directly: for a non-2xx `/api/chat`
  response the AI SDK throws `new Error(await response.text())`, so the message
  is the raw `{ error: { code, messageKey } }` body. Resolve it through
  `apiErrorMessageFromUnknown(error, tErrors, "actions.sendMessage")`.
- Clearing the draft bucket before the request succeeds, which loses the
  attachments on a failed send.
- Showing chip status only through color: pair it with text or an icon that is
  present on screen.

---

## Scenario: attachment management page (`/settings/files`)

### 1. Scope / Trigger

A user-facing surface over the whole attachment lifecycle (list → preview →
delete) that reuses the composer's classification and the same authenticated
`/api/files/[id]` transport. It is a settings page, so it inherits the settings
layout guard and the `src/components/settings/` primitives, and it must stay
usable on touch-only clients.

### 2. Signatures

```ts
// src/lib/api/files.ts
listChatFiles({ offset, limit, category }): Promise<FileListResponse>  // GET /api/files
getFileLimits(): Promise<FileLimits>   // usedBytes / quotaBytes drive the usage card

// src/hooks/use-file-limits.ts
fileKeys = { all, list, limits }                  // query-key factory; category is part of the list key
useFileLimits(): UseQueryResult                 // the usage card's and composer's only limits source

// src/components/settings/files/use-files.ts
useFileList(category): UseInfiniteQueryResult   // offset "load more" pages
```

Row deletion is dialog-first through a single `BatchDeleteDialog` (base-ui
Dialog); the single-row action is the N=1 case of the batch flow.

### 3. Contracts

- **Route registration**: `/settings/files` is a `SETTINGS_TABS` entry visible to
  every signed-in user (not `staffOnly`); `SettingsTabLabelKey` gains the
  matching key, and the settings layout supplies the sign-in redirect. Page
  width is the page's own choice (`max-w-3xl`), not the layout's.
- **Usage card reads the limits endpoint only** — never the list response's
  `totalBytes`. It renders `used / quota (N%)`, degrades to `used` alone when
  `quotaBytes === null` (unlimited), and treats `quotaBytes === 0` as a real
  quota (0%), not as unlimited. `??`/`=== null` checks only — a falsy check
  silently turns a 0-byte quota into "unlimited".
- **Row actions are always visible.** Preview / download / delete are inline
  buttons, never hover-revealed (touch has no hover); narrow screens may shrink
  labels to icons but not hide them. This is the same rule as the composer
  chips.
- **Preview by category**: images open in a dialog with
  `<img src={/api/files/<id>}>` (the authenticated same-origin GET; no object
  URL, no `next/image` — the optimizer would not carry the session cookie and
  is silenced per line with a reason), everything else is a plain `<a
  target="_blank">` and lets the server's `Content-Disposition` decide inline
  vs download.
- **Delete** is dialog-confirmed; `referenced: true` rows disable the action and
  state why in visible text plus `aria-describedby` (a disabled button cannot
  take focus and `title` is hover-only). The 409 is still handled: the mock-free
  truth is the server, so a stale `referenced: false` surfaces the localized
  `file.inUse` message inline. On success the mutation invalidates the whole
  `fileKeys` domain, so the list *and* the usage card refresh together.
- **Pending rows** (`sizeBytes === 0`, a presign placeholder or a genuinely
  empty file) render as `0 B` — never as an error or a spinner-less void.
  Do not infer "unfinished upload" from the size: 0 is sendable.
- **Batch selection**: a row checkbox plus a header select-all that covers
  only the loaded, unreferenced rows (indeterminate state included);
  `referenced` rows are unselectable with `aria-describedby` at the in-use
  badge, same contract as the disabled delete button. A toolbar shows when
  the selection is non-empty; confirming deletes with
  `Promise.allSettled(ids.map(deleteChatFile))` — deliberately **no server
  bulk endpoint**, so the per-file semantics (ownership, 409, provider-side
  cleanup) stay exactly the DELETE contract — then one `fileKeys.all`
  invalidation and a summary "Deleted X · skipped Y (in use)" (the skip is
  the 409 race: a file referenced between list load and delete). The
  selection clears on category switch, dialog close, or cancel, and never
  silently adopts rows fetched by "load more".
- Pagination is offset-based "load more": `hasMore = files.length <
  totalCount` where `totalCount` is the **filtered** count; switching category
  resets to the first page by way of the query key.

### 4. Validation & Error Matrix

| Condition | Client behaviour |
|---|---|
| list request fails | error state with retry; the page keeps its chrome |
| limits request fails | usage card shows an error/placeholder, the list still works |
| `quotaBytes === null` | `used` only, no percentage |
| `quotaBytes === 0` | `used / 0 B (…%)` — a real cap, not unlimited |
| row `referenced: true` | delete disabled + visible "in use" badge, `aria-describedby` |
| delete returns 409 `file.inUse` | localized `file.inUse` message inline; row refreshed to `referenced: true` |
| delete succeeds | row removed, list + usage refetched |
| category with no rows | empty state that names the active filter |

### 5. Good / Base / Bad Cases

- **Good**: filter to "document", load a second page, preview an image in the
  dialog, delete an unused file → it disappears and the usage number drops.
- **Base**: no attachments at all → friendly empty state, usage shows
  `0 B / 5 GiB (0%)`.
- **Bad**: deriving the badge from the list response's `sizeBytes` or the
  filter from `mediaType` alone — the server's category predicate mirrors
  `classifyFile`, extension fallback included, so the client must never
  re-implement a second classification for display.

### 6. Tests Required

- `FilesList.test.tsx`: renders filename/size/time/badge; `sizeBytes === 0`
  renders `0 B`; actions are always visible (no `opacity-0` / `group-hover`
  ancestor); disabled delete carries `aria-describedby` at the in-use badge.
- `UsageCard.test.tsx`: `quotaBytes === 0` (0 B denominator, and 100% when
  used > 0) and `quotaBytes === null` (no percentage).
- `FilesScreen.test.tsx`: empty state per category; "load more" within an
  active category advances the offset and stops at the last page; delete
  confirm → success removes the row and invalidates both queries; 409 keeps the
  dialog open with the localized message.
- `SettingsNav.test.tsx`: `/settings/files` is listed for non-staff users.
- `FilesScreen.test.tsx` batch cases: select-all covers loaded unreferenced
  rows only; mixed 409s yield the "Deleted X · skipped Y" summary; the
  selection clears on dialog close and category switch.
- Backend side (see [backend/chat-attachments.md](../backend/chat-attachments.md))
  owns the filter/badge equivalence table.

### 7. Wrong vs Correct

#### Wrong

```tsx
// A falsy check turns an explicit 0-byte quota into "unlimited".
const unlimited = !limits.quotaBytes;
```

#### Correct

```tsx
const unlimited = limits.quotaBytes === null;
```

#### Wrong

```tsx
// Hover-revealed row actions: unreachable on a touch-only client.
<div className="opacity-0 group-hover/row:opacity-100">…</div>
```

#### Correct

```tsx
// Always mounted, always visible; only the label shrinks on narrow screens.
<Button type="button" variant="ghost" size="icon-sm" aria-label={t("preview")} …>
```
