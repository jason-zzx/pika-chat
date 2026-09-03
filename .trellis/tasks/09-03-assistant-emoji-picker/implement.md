# Implement — Assistant emoji picker

## Checklist

1. Install the shadcn Frimousse picker
   (`pnpm dlx shadcn@latest add https://frimousse.liveblocks.io/r/emoji-picker`).
   Confirm `frimousse` is pinned in `package.json`. Open generated
   `src/components/ui/emoji-picker.tsx`; fix only CLI path leaks, no restyle.
2. Raise `createAssistantSchema.icon` from `.max(8)` to `.max(32)` in
   `src/lib/schemas/assistant.ts`.
3. Add `src/components/assistant/AssistantEmojiPicker.tsx` per `design.md`
   (Base UI `render` trigger, Popover, Enter guard, labelled search).
4. In `AssistantEditorDialog.tsx`, replace the Emoji `Input` with
   `AssistantEmojiPicker` (`id="assistant-icon"`, `value`/`onChange` from
   existing `icon` state). Keep the "Emoji" `Label`.
5. Tests:
   - `AssistantEditorDialog.test.tsx`: no Emoji textbox; labelled control;
     default `✨` still saved; selection updates Save `icon`; Enter in search
     does not submit.
   - Schema parse: length 11 ok, 33 rejected (colocate with editor test or a
     small `assistant` schema assertion — do not add a snapshot).
6. `pnpm lint`, `pnpm typecheck`, `pnpm test`.
7. Browser: create + edit, search, select, Esc, both breakpoints (AC6).

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Risky files

- `src/components/ui/emoji-picker.tsx` — generated; do not hand-edit for style.
- `src/components/assistant/AssistantEditorDialog.tsx` — shared create/edit form;
  do not break ModelPicker or Save.
- `src/lib/schemas/assistant.ts` — shared client/server contract.

## Rollback

Revert those files plus `package.json` / lockfile `frimousse`. No migration to
undo.

## Follow-up before `task.py start`

- `prd.md`, `design.md`, `implement.md` reviewed.
- `implement.jsonl` and `check.jsonl` have real spec/research rows.
- User approved the planning summary.
