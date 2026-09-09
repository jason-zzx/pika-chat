"use client";

import { BotIcon } from "lucide-react";

import { useAssistantTree } from "@/components/assistant/use-assistants";
import {
  Select,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

import ComposerPickerContent from "./ComposerPickerContent";
import ComposerSelectTrigger from "./ComposerSelectTrigger";

type AssistantPickerProps = {
  value: string | undefined;
  onChange: (assistantId: string) => void;
  disabled?: boolean;
};

export default function AssistantPicker({
  value,
  onChange,
  disabled = false,
}: AssistantPickerProps) {
  const tree = useAssistantTree();
  const assistants = tree.data?.assistants ?? [];
  const selected = assistants.find((row) => row.id === value);
  const selectValue = selected ? selected.id : "";

  return (
    <Select
      // Non-modal: an outside tap closes this popup and activates the tapped
      // picker in one gesture; modal selects swallow the first press.
      modal={false}
      value={selectValue}
      onValueChange={(next) => {
        if (typeof next === "string" && next.length > 0) {
          onChange(next);
        }
      }}
      disabled={disabled || tree.isPending}
    >
      <ComposerSelectTrigger label="Assistant" title={selected?.name}>
        <SelectValue
          className="justify-center text-center"
          placeholder={<BotIcon aria-hidden="true" className="size-4" />}
        >
          {selected ? selected.icon : null}
        </SelectValue>
      </ComposerSelectTrigger>
      <ComposerPickerContent variant="select">
        {assistants.map((assistant) => (
          <SelectItem key={assistant.id} value={assistant.id}>
            {assistant.icon} {assistant.name}
          </SelectItem>
        ))}
      </ComposerPickerContent>
    </Select>
  );
}
