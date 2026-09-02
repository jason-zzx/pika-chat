"use client";

import { useAssistantTree } from "@/components/assistant/use-assistants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      value={selectValue}
      onValueChange={(next) => {
        if (typeof next === "string" && next.length > 0) {
          onChange(next);
        }
      }}
      disabled={disabled || tree.isPending}
    >
      <SelectTrigger size="sm" aria-label="Assistant">
        <SelectValue placeholder="Select an assistant">
          {selected ? `${selected.icon} ${selected.name}` : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {assistants.map((assistant) => (
          <SelectItem key={assistant.id} value={assistant.id}>
            {assistant.icon} {assistant.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
