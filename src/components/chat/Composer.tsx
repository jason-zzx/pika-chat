"use client";

import {
  ArrowUpIcon,
  BrainIcon,
  MapIcon,
  Maximize2Icon,
  Minimize2Icon,
  PaperclipIcon,
  SquareIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useAvailableModels } from "@/components/provider/use-available-models";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import { SUPPORTED_FILE_ACCEPT } from "@/lib/files/media-types";
import { cn } from "@/lib/utils";
import type {
  ComposerModelPick,
  StagedAttachment,
} from "@/stores/composer-store";

import AttachmentChip from "./AttachmentChip";
import AssistantPicker from "./AssistantPicker";
import ComposerPickerContent from "./ComposerPickerContent";
import { stagedAttachmentSlotCount } from "./use-composer-attachments";
import ComposerSelectTrigger from "./ComposerSelectTrigger";
import { findAvailableModel } from "./model-pick";
import ModelPicker from "./ModelPicker";
import SearchModePicker from "./SearchModePicker";

const AUTO_EFFORT = "__auto";

const MIN_ROWS = 2;

type ComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  model: ComposerModelPick | null;
  onModelChange: (value: ComposerModelPick | null) => void;
  assistantId?: string;
  onAssistantChange?: (assistantId: string) => void;
  showAssistantPicker: boolean;
  inFlight: boolean;
  modelPickerDisabled?: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  reasoningEffort: string | null;
  onReasoningEffortChange: (value: string | null) => void;
  /** Opens the chat map overview listing every message. */
  onOpenChatMap: () => void;
  /** No messages yet — there is nothing to jump to. */
  chatMapDisabled?: boolean;
  /** Attachments staged for the active draft (upload-on-selection). */
  attachments?: StagedAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
};

export default function Composer({
  draft,
  onDraftChange,
  model,
  onModelChange,
  assistantId,
  onAssistantChange,
  showAssistantPicker,
  inFlight,
  modelPickerDisabled = false,
  canSend,
  onSend,
  onStop,
  reasoningEffort,
  onReasoningEffortChange,
  onOpenChatMap,
  chatMapDisabled = false,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
}: ComposerProps) {
  const t = useTranslations("Chat.Composer");
  const tFiles = useTranslations("Files");
  const models = useAvailableModels();
  const selected = findAvailableModel(models.data, model);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowsCollapsed, setOverflowsCollapsed] = useState(false);
  const showExpandToggle = expanded || overflowsCollapsed;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    setOverflowsCollapsed(el.scrollHeight > el.clientHeight + 1);
  }, [draft, expanded]);

  function collapseAndSend() {
    setExpanded(false);
    onSend();
  }

  function handleDraftChange(value: string) {
    if (value.length === 0) {
      setExpanded(false);
    }
    onDraftChange(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight) {
      onStop();
      return;
    }
    if (canSend) {
      collapseAndSend();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !inFlight) {
        collapseAndSend();
      }
    }
  }

  function addFiles(files: FileList | null) {
    if (inFlight || !files || files.length === 0 || !onAddFiles) {
      return;
    }
    onAddFiles(Array.from(files));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData?.files;
    if (files && files.length > 0 && onAddFiles) {
      event.preventDefault();
      addFiles(files);
    }
  }

  const attachmentCapReached =
    stagedAttachmentSlotCount(attachments) >= MAX_ATTACHMENTS_PER_MESSAGE;

  return (
    <form
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col p-3",
        expanded && "max-h-[max(50%,18rem)]",
      )}
      onSubmit={handleSubmit}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[52.5rem] flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-muted/40">
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  disabled={inFlight}
                  onRemove={() => onRemoveAttachment?.(attachment.id)}
                  onRetry={() => onRetryAttachment?.(attachment.id)}
                />
              ))}
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            aria-label={t("messageLabel")}
            placeholder={t("messageLabel")}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={inFlight}
            rows={MIN_ROWS}
            className={cn(
              "field-sizing-content flex-1 resize-none overflow-y-auto border-0 bg-transparent leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent",
              "disabled:bg-transparent dark:disabled:bg-transparent",
              "thin-scrollbar",
              "min-h-[3rem] px-3 py-2",
              expanded ? "min-h-[18rem] max-h-full" : "max-h-[9rem]",
            )}
          />
          <div className="flex items-end justify-between gap-2 p-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {showAssistantPicker && onAssistantChange ? (
                <AssistantPicker
                  value={assistantId}
                  onChange={onAssistantChange}
                  disabled={inFlight}
                />
              ) : null}
              <ModelPicker
                value={model}
                onChange={onModelChange}
                disabled={inFlight || modelPickerDisabled}
                iconOnly
              />
              {onAddFiles ? (
                <>
                  <Button
                    // Composer root is a <form>: without an explicit type
                    // this would submit the draft.
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    // bg-transparent matches the Select-based pickers on the
                    // muted composer container (outline variant defaults to
                    // bg-background).
                    className="bg-transparent"
                    aria-label={tFiles("attach")}
                    disabled={inFlight || attachmentCapReached}
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
                      addFiles(event.target.files);
                      // Allow re-selecting the same file after removing it.
                      event.target.value = "";
                    }}
                  />
                </>
              ) : null}
              <SearchModePicker disabled={inFlight} />
              {selected?.reasoning ? (
                <ReasoningEffortSelect
                  options={selected.reasoningOptions}
                  value={reasoningEffort}
                  onChange={onReasoningEffortChange}
                  disabled={inFlight}
                />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                // Composer root is a <form>: without an explicit type this
                // would submit the draft.
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("chatMap")}
                disabled={chatMapDisabled}
                onClick={onOpenChatMap}
              >
                <MapIcon aria-hidden="true" />
              </Button>
              {showExpandToggle ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={expanded ? t("collapse") : t("expand")}
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? (
                    <Minimize2Icon aria-hidden="true" />
                  ) : (
                    <Maximize2Icon aria-hidden="true" />
                  )}
                </Button>
              ) : null}
              {inFlight ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label={t("stop")}
                  onClick={onStop}
                >
                  <SquareIcon aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label={t("send")}
                  disabled={!canSend}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function ReasoningEffortSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const t = useTranslations("Chat.Composer");
  return (
    <Select
      // Non-modal: an outside tap closes this popup and activates the tapped
      // picker in one gesture; modal selects swallow the first press.
      modal={false}
      value={value ?? AUTO_EFFORT}
      onValueChange={(next) => {
        if (typeof next !== "string") {
          return;
        }
        onChange(next === AUTO_EFFORT ? null : next);
      }}
      disabled={disabled}
    >
      <ComposerSelectTrigger
        label={t("reasoningEffort")}
        title={value ?? t("auto")}
      >
        <BrainIcon aria-hidden="true" />
      </ComposerSelectTrigger>
      <ComposerPickerContent variant="select">
        <SelectItem value={AUTO_EFFORT}>{t("auto")}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </ComposerPickerContent>
    </Select>
  );
}
