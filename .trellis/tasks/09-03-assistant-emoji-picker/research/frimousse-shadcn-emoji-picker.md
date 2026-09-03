# Frimousse + shadcn emoji picker

Sources: [frimousse.liveblocks.io](https://frimousse.liveblocks.io/),
[v0.2.0 notes](https://github.com/liveblocks/frimousse/releases/tag/v0.2.0),
current app Popover (`src/components/ui/popover.tsx`, Base UI).

## Install

```bash
pnpm dlx shadcn@latest add https://frimousse.liveblocks.io/r/emoji-picker
```

Adds `frimousse` and generated `src/components/ui/emoji-picker.tsx`. That file
is generated territory — compose it, do not restyle by hand-editing.

The Frimousse site example uses Radix `PopoverTrigger asChild`. This repo's
popover is Base UI and has no `asChild`. The working pattern is
`ModelPicker.tsx`: `PopoverTrigger render={<Button type="button" ... />}`.

## Composition (from the shadcn example, adapted)

Trigger button showing the current emoji → `Popover` → `PopoverContent`
`className="w-fit p-0"` → `EmojiPicker` with `onEmojiSelect(({ emoji }) => …)`
→ close popover, set form `icon` to `emoji`.

Parts: `EmojiPicker`, `EmojiPickerSearch`, `EmojiPickerContent`, optional
`EmojiPickerFooter`.

## Data loading

Default `emojibaseUrl` is `https://cdn.jsdelivr.net/npm/emojibase-data`.
Files: `${emojibaseUrl}/{locale}/{file}.json` (e.g. `en/data.json`). Locale
defaults to `"en"`. Data is fetched on demand and cached locally. Unsupported
glyphs are hidden. First open needs network; a loading slot exists.

Self-host via `emojibaseUrl` is possible and out of scope for this task.

## Nested in AssistantEditorDialog

`ModelPicker` already mounts a Base UI Popover inside this Dialog, including
an Enter-key guard so search does not submit the form
(`ModelPicker.tsx:89-96`). Reuse that guard on the emoji search field.

Popover content portals (`popover.tsx:29`), so dialog `max-w-md` does not clip
the list. On small viewports, cap picker width (`max-w-[calc(100vw-2rem)]`)
rather than inventing a separate Sheet.

## Tests

jsdom will hit the CDN unless `fetch` is stubbed. Prefer a tiny Emojibase-shaped
fixture over mocking `@/components/ui/emoji-picker`. Do not snapshot the
generated primitive.
