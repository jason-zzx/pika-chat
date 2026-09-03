# Design — Assistant emoji picker

## Boundary

Replace the Emoji `Input` in `AssistantEditorDialog` with a domain picker that
composes generated shadcn/Frimousse parts inside the existing Base UI Popover.
Raise the shared Zod `icon` max so picker ZWJ sequences save. Do not touch
sidebar layout, assistant CRUD services, or the `assistants.icon` column type.

```
AssistantEditorDialog
  → AssistantEmojiPicker          (domain; one caller)
      → Button + Popover          (existing ui/)
      → EmojiPicker*              (generated ui/emoji-picker.tsx)
  createAssistantSchema.icon      max 8 → 32
```

## Contracts

Unchanged request shape: `{ name, icon, systemPrompt, defaultProviderConfigId,
defaultModelId }`. `icon` remains a trimmed string, now `.min(1).max(32)`.
Route Handlers already `parse` that schema; no new endpoint.

Picker `onEmojiSelect` receives `{ emoji: string }`. That string becomes the
form `icon`. Do not send a name, slug, or codepoint.

## UI composition

`src/components/assistant/AssistantEmojiPicker.tsx` — default export, props
`value`, `onChange`, `id`, optional `disabled`. One component per file; promote
out of `assistant/` only if a second domain needs it.

Trigger: `PopoverTrigger` with Base UI `render={<Button type="button"
variant="outline" … />}` (see `ModelPicker.tsx:69-79`), `id` wired to the
existing `Label htmlFor="assistant-icon"`. Visible children: the current emoji
string. If the visible text is only the glyph, keep the label association so
the control is not an unlabelled icon button.

`PopoverContent`: `align="start"`, `w-(--anchor-width)` (match the trigger /
Emoji field, same token as `select.tsx`), plus a viewport cap
(`max-w-[calc(100vw-2rem)]`). Inner `EmojiPicker` is `w-full h-80`, `columns={8}`,
with domain-level size overrides on `[data-slot=emoji-picker-emoji]` (`size-11
text-2xl`) so cells are tappable without editing generated `ui/emoji-picker.tsx`.
`onEmojiSelect`: `onChange(emoji)`, close popover.

Search: labelled. On `Enter` in that field, `preventDefault` so the parent
`<form>` does not save (`ModelPicker.tsx:89-96`).

Install via shadcn CLI (research note). After add, grep the generated file for
leaked `@/app/(create)/` imports and fix those only.

Do not copy Frimousse docs' `asChild`.

## Data

Default Frimousse CDN + locale `"en"`. Leave `emojibaseUrl` / `emojiVersion`
unset. The picker has loading and empty slots; use them, do not invent a
second skeleton.

## Schema

`src/lib/schemas/assistant.ts`: `icon: z.string().trim().min(1).max(32)`.
`updateAssistantSchema` stays `createAssistantSchema.partial()`. No Drizzle
change, no migration.

## Tests

- Editor: no `textbox` named Emoji; labelled Emoji control shows `✨` on
  create and the stored icon on edit; Save still works with the default icon.
- Picker: mock generated `ui/emoji-picker` (search + one gridcell). Selecting
  updates the trigger; Save payload `icon` is the selection. Enter in search
  still hits the real popover `preventDefault` and must not call create.
- Zod: `createAssistantSchema` accepts UTF-16 length 11 and 32, rejects 33.
  Do not retest `updateAssistantSchema.partial()`.

Do not boot Frimousse in jsdom (no Emojibase `fetch` / ResizeObserver harness).
Do not snapshot `ui/emoji-picker.tsx`.

## Compatibility / rollback

Existing rows are valid at any length the old UI could store (≤8). Raising max
is additive. Rollback: revert the dialog, generated file, `frimousse` dep, and
the Zod max; no DB reverse migration.

## Trade-offs

| Choice | Why |
|---|---|
| Domain wrapper, not inline in the dialog | Dialog already orchestrates four fields; picker has open/search/select |
| CDN emoji data | Accepted with D4; self-host is extra product surface |
| max 32, not grapheme parsing | Matches prior "don't pretend to parse clusters"; 32 covers ZWJ families |
| Popover, not Sheet | Same nested pattern as ModelPicker; one mobile path |
