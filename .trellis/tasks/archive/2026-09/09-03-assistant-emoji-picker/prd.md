# Assistant emoji picker

## Goal

When creating or editing an assistant, the user chooses its icon from a
searchable emoji picker. They do not type or paste into a text field.

## Background

Create/edit is one dialog (`AssistantEditorDialog.tsx:120-129`) with a required
"Emoji" `Input`, `maxLength={8}`, default `DEFAULT_ASSISTANT_ICON` (`✨`,
`src/lib/schemas/assistant.ts:6`). `createAssistantSchema.icon` is
`z.string().trim().min(1).max(8)` (`assistant.ts:26`). The DB column is unbounded
`text` (`src/server/db/schema/assistant.ts:15`).
`08-31-assistants-topics` already recorded that nothing requires one emoji; a
pasted sentence stretches the sidebar, and `max(8)` only limits that damage
without parsing grapheme clusters
(`archive/2026-09/08-31-assistants-topics/design.md:420-423`).

Readers (`AssistantTree`, `AssistantPicker`) already render `icon` as text.
Collapsed icon-mode wrapping stays as specified by
`09-02-mvp-sidebar-composer-model-ux` D19. The same editor already nests
`ModelPicker`'s Base UI Popover. `components/ui/` is generated
(`.trellis/spec/frontend/directory-structure.md:52-55`). No emoji-picker
package is installed today.

## Decisions

**D1 — Full searchable Unicode picker; the text field goes away.** shadcn
Frimousse picker in a Popover. The Emoji row is a labelled button showing the
current icon. Click opens the picker (search + categories). Selecting an emoji
sets the form value and closes the popover. Save still sends `icon` on create
and update. No typing or paste in this control.

**D2 — Keep a short-string API; raise `max` from 8 to 32.** A full picker can
emit ZWJ sequences whose UTF-16 length exceeds 8 (e.g. family emoji). Raising
the Zod bound lets those save. Do not add grapheme-cluster parsing. No
migration: the column is already unbounded text. Crafted API requests can still
send up to 32 non-emoji characters; that is the same class of cosmetic sidebar
risk as today's `max(8)`, now without a form that invites it.

**D3 — Existing stored icons stay until the user picks a replacement.** The
button displays whatever is already saved, including non-emoji leftovers. No
backfill.

**D4 — Emojibase data stays on the default CDN.** First picker open may fetch
`https://cdn.jsdelivr.net/npm/emojibase-data` and cache locally. Self-hosting
via `emojibaseUrl` is deferred.

**D5 — Picker chrome matches the Emoji field; glyphs are larger than the
generated default.** The popover is `w-(--anchor-width)` (same as Select).
Emoji cells are 44px (`size-11`) in 8 columns so they are tappable, not the
generated `size-7` / 10-column dense grid. Style overrides live on the domain
wrapper; do not restyle generated `ui/emoji-picker.tsx`.

## Requirements

- **R1.** `AssistantEditorDialog` (create and edit) has no text input for emoji.
  The Emoji control is a labelled button that shows the current `icon`.
- **R2.** Clicking the button opens a searchable emoji picker. Choosing an emoji
  updates the unsaved form value, closes the picker, and is what Save persists.
- **R3.** A new assistant still starts from `DEFAULT_ASSISTANT_ICON` (`✨`) until
  the user picks something else.
- **R4.** Keyboard: the button is reachable; picker search is labelled; Enter in
  search does not submit the editor form (same trap as `ModelPicker`).
- **R5.** `createAssistantSchema` / `updateAssistantSchema` accept `icon` of
  length 1–32 after trim. No new endpoints, no DB migration.
- **R6.** Sidebar, collapsed header, and `AssistantPicker` keep rendering `icon`
  as they do now.

## Acceptance Criteria

- [ ] **AC1.** Create/Edit assistant: there is no Emoji textbox. A control
      labelled Emoji shows the current icon. (R1, R3)
- [ ] **AC2.** Opening that control, searching, and selecting an emoji updates
      the button. Save sends that emoji as `icon`. Esc/click-outside closes the
      picker without saving. (R2)
- [ ] **AC3.** Enter in the picker search does not submit the assistant form.
      The trigger has an accessible name. (R4)
- [ ] **AC4.** An icon whose UTF-16 length is between 9 and 32 (inclusive) is
      accepted by the shared Zod schema. Longer than 32 is rejected. (R5, D2)
- [ ] **AC5.** An assistant whose stored icon is unchanged still shows that icon
      in the sidebar and picker. (R6, D3)
- [ ] **AC6.** Desktop and a narrow viewport: the picker is usable (not clipped
      into an unscrollable strip; not wider than the viewport). The open
      popover matches the Emoji field width. Emoji cells are large enough to
      tap (D5).

## Out of scope

- Avatars, Lucide icons, or any non-emoji icon type.
- Composer / message emoji insertion.
- Self-hosting Emojibase data, pinning `emojiVersion`, or extra locales.
- Grapheme-cluster validation, or rewriting existing `icon` rows.
- Changing how the sidebar or `AssistantPicker` *lays out* an icon (D19 stays).
- Hand-editing generated `components/ui/` beyond fixing a CLI path leak.

## Risks / deferred

- First picker open depends on jsDelivr (D4). Loading/empty states are the
  library's; offline first-open shows empty/loading, not a fallback grid.
- Nested Popover-in-Dialog: already proven by `ModelPicker` in this dialog.
  Follow that Base UI `render` trigger, not Radix `asChild`.
