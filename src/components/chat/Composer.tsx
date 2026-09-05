"use client";

import {
  ArrowUpIcon,
  BrainIcon,
  Maximize2Icon,
  Minimize2Icon,
  SquareIcon,
} from "lucide-react";
import {
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ComposerModelPick } from "@/stores/composer-store";

import AssistantPicker from "./AssistantPicker";
import { findAvailableModel } from "./model-pick";
import ModelPicker from "./ModelPicker";

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
}: ComposerProps) {
  const models = useAvailableModels();
  const selected = findAvailableModel(models.data, model);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
          <Textarea
            ref={textareaRef}
            aria-label="Message"
            placeholder="Message"
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
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
              {showExpandToggle ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={expanded ? "Collapse composer" : "Expand composer"}
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
                  aria-label="Stop"
                  onClick={onStop}
                >
                  <SquareIcon aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="Send"
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
      <SelectTrigger
        size="sm"
        aria-label="Reasoning effort"
        title={value ?? "Auto"}
      >
        <SelectValue>
          <BrainIcon aria-hidden="true" />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_EFFORT}>Auto</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
