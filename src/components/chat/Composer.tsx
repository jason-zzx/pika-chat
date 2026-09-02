"use client";

import { SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import AssistantPicker from "./AssistantPicker";
import ModelPicker from "./ModelPicker";
import type { ComposerModelPick } from "@/stores/composer-store";

type ComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  model: ComposerModelPick | null;
  onModelChange: (value: ComposerModelPick | null) => void;
  assistantId?: string;
  onAssistantChange?: (assistantId: string) => void;
  showAssistantPicker: boolean;
  inFlight: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
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
  canSend,
  onSend,
  onStop,
}: ComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight) {
      onStop();
      return;
    }
    if (canSend) {
      onSend();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !inFlight) {
        onSend();
      }
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-border p-3"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-center gap-2">
        {showAssistantPicker && onAssistantChange ? (
          <AssistantPicker
            value={assistantId}
            onChange={onAssistantChange}
            disabled={inFlight}
          />
        ) : null}
        <ModelPicker value={model} onChange={onModelChange} disabled={inFlight} />
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Message"
          placeholder="Message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inFlight}
          rows={2}
          className="min-h-12 flex-1 resize-none"
        />
        {inFlight ? (
          <Button type="button" variant="secondary" onClick={onStop}>
            <SquareIcon aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
