"use client";

import { PaperclipIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { attachmentLimitFor } from "@/lib/files/constants";
import { SUPPORTED_FILE_ACCEPT } from "@/lib/files/media-types";
import type {
  ChatFilePart,
  ChatRequestPart,
  ChatUIMessage,
} from "@/lib/schemas/chat";
import type { StagedAttachment } from "@/stores/composer-store";

import AttachmentChip from "./AttachmentChip";
import {
  stagedAttachmentSlotCount,
  useComposerAttachments,
} from "./use-composer-attachments";

type UserMessageEditorProps = {
  /** The currently shown version: its text pre-fills the textarea and its
   * file parts seed the staged chips. */
  message: ChatUIMessage;
  /** Hands the new version's parts (files first, then text — the order the
   * server persists) to the parent, which owns the edit-and-regenerate
   * request and its failure rollback. */
  onSubmit: (parts: ChatRequestPart[]) => void;
  /** Exits the editor without any server write (PRD R4). */
  onCancel: () => void;
  /** True while a turn is in flight (chat or regen): the edit entry itself is
   * hidden then (PRD R8), but a stream can still start from the composer
   * while an editor is open — the send button holds until it ends instead of
   * silently dropping the edit. */
  locked?: boolean;
};

/**
 * In-place editor for a sent user message (edit-and-regenerate). Attachment
 * staging reuses the composer's hook verbatim — same upload flow, same
 * chip-level validation/quota errors — under a per-edit-session store key,
 * so no upload/validation logic is duplicated here.
 */
export default function UserMessageEditor({
  message,
  onSubmit,
  onCancel,
  locked = false,
}: UserMessageEditorProps) {
  const tActions = useTranslations("Chat.Actions");
  const tComposer = useTranslations("Chat.Composer");
  const tCommon = useTranslations("Common");
  const tFiles = useTranslations("Files");

  const [text, setText] = useState(() =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Entering the editor is an explicit click, so move focus into the draft
  // (the jsx-a11y autoFocus ban covers page load, not an invoked editor).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // One staging bucket per edit session, keyed by the version group so the
  // optimistic version swap on submit (new row id, same group) does not
  // orphan the bucket.
  const editKey = `edit:${message.metadata?.groupId ?? message.id}`;
  const {
    attachments,
    addFiles,
    removeAttachment,
    retryAttachment,
    clearAttachments,
    stageReference,
  } = useComposerAttachments(editKey);

  // Seed the bucket from the shown version's file parts on entry (a fresh
  // clear first: a leaked bucket from an aborted edit must not resurrect
  // removed chips) and always drop it on exit — cancel writes nothing,
  // submit hands the parts over before the unmount cleanup runs.
  const initialFileParts = useRef(
    // Same stored-part widening as MessageItem: `sizeBytes` is carried
    // structurally on the row's file parts (the SDK type does not know it).
    message.parts.filter((part): part is ChatFilePart => part.type === "file"),
  );
  useEffect(() => {
    clearAttachments(editKey);
    for (const part of initialFileParts.current) {
      stageReference({
        url: part.url,
        mediaType: part.mediaType,
        filename: part.filename,
        sizeBytes: part.sizeBytes,
      });
    }
    return () => clearAttachments(editKey);
  }, [editKey, clearAttachments, stageReference]);

  const readyAttachments = attachments.filter(
    (attachment): attachment is StagedAttachment & { url: string } =>
      attachment.status === "ready" && attachment.url !== undefined,
  );
  // Same rule as the composer: an uploading or failed chip blocks the send
  // so an attachment is never silently dropped.
  const settled = attachments.every(
    (attachment) => attachment.status === "ready",
  );
  // Attachment-only edits are legal (chatRequestMessageSchema allows a
  // file-only parts list); fully empty content is not (PRD R7).
  const canSubmit =
    settled && (text.trim().length > 0 || readyAttachments.length > 0);
  const attachmentCapReached =
    stagedAttachmentSlotCount(attachments) >= attachmentLimitFor(0);

  function handleSubmit() {
    if (locked || !canSubmit) {
      return;
    }
    const trimmed = text.trim();
    // An empty filename would fail the wire schema's `.min(1)` — omit it
    // instead (a legacy part may carry none). `sizeBytes` rides along when
    // known so the optimistic message card shows the size.
    const parts: ChatRequestPart[] = [
      ...readyAttachments.map((attachment) => ({
        type: "file" as const,
        url: attachment.url,
        mediaType: attachment.mediaType,
        ...(attachment.filename ? { filename: attachment.filename } : {}),
        ...(attachment.sizeBytes !== undefined
          ? { sizeBytes: attachment.sizeBytes }
          : {}),
      })),
      ...(trimmed.length > 0 ? [{ type: "text" as const, text: trimmed }] : []),
    ];
    onSubmit(parts);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Same keyboard contract as the composer: Enter sends, Shift+Enter
    // inserts a newline; Escape cancels the edit.
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex w-full max-w-[min(100%,42rem)] flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => removeAttachment(attachment.id)}
              onRetry={() => retryAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        aria-label={tActions("editMessage")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        className="field-sizing-content thin-scrollbar max-h-[12rem] min-h-[3rem] resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          // bg-transparent matches the muted editor container (the outline
          // variant defaults to bg-background), as on the composer.
          className="bg-transparent"
          aria-label={tFiles("attach")}
          title={tFiles("attach")}
          disabled={attachmentCapReached}
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperclipIcon aria-hidden="true" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SUPPORTED_FILE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              addFiles(Array.from(event.target.files));
            }
            // Allow re-selecting the same file after removing it.
            event.target.value = "";
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={locked || !canSubmit}
            onClick={handleSubmit}
          >
            {tComposer("send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
