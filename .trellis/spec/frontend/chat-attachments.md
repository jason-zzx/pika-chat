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
src/lib/api/files.ts                              uploadChatFile / deleteChatFile / fetchFileLimits / uploadChatFileDirect
src/lib/files/media-types.ts                      classifyFile / SUPPORTED_FILE_ACCEPT
src/lib/files/format.ts                           formatBytes
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
- **The size limit is runtime config.** The composer fetches
  `/api/files/limits` on mount, pre-checks against `maxFileBytes`, and labels
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
