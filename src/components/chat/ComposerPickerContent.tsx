"use client";

import type { KeyboardEventHandler, ReactNode } from "react";

import { PopoverContent } from "@/components/ui/popover";
import { SelectContent } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ComposerPickerContentProps = {
  children: ReactNode;
  variant?: "popover" | "select";
  side?: "top" | "bottom";
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

export default function ComposerPickerContent({
  children,
  variant = "popover",
  side = "top",
  className,
  onKeyDown,
}: ComposerPickerContentProps) {
  const contentClassName = cn(
    "max-h-(--available-height) max-w-(--available-width) overflow-y-auto p-2 duration-150 data-[side=top]:slide-out-to-bottom-2 data-[side=bottom]:slide-out-to-top-2 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none",
    className,
  );

  if (variant === "select") {
    return (
      <SelectContent
        side={side}
        align="start"
        alignItemWithTrigger={false}
        className={contentClassName}
        onKeyDown={onKeyDown}
      >
        {children}
      </SelectContent>
    );
  }

  return (
    <PopoverContent
      side={side}
      align="start"
      className={contentClassName}
      onKeyDown={onKeyDown}
    >
      {children}
    </PopoverContent>
  );
}
