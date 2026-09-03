"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type AssistantEmojiPickerProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
};

export default function AssistantEmojiPicker({
  value,
  onChange,
  id,
}: AssistantEmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
          />
        }
      >
        {value}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) max-w-[calc(100vw-2rem)] p-0"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
          }
        }}
      >
        <EmojiPicker
          className="h-80 w-full [&_[data-slot=emoji-picker-emoji]]:size-11 [&_[data-slot=emoji-picker-emoji]]:text-2xl [&_[data-slot=emoji-picker-row]]:flex [&_[data-slot=emoji-picker-row]]:justify-between"
          columns={8}
          onEmojiSelect={({ emoji }) => {
            onChange(emoji);
            setOpen(false);
          }}
        >
          <EmojiPickerSearch aria-label="Search emoji" />
          <EmojiPickerContent />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
