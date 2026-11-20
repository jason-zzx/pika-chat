"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type ComposerSelectTriggerProps = {
  children: ReactNode;
  label: string;
  title?: string;
};

export default function ComposerSelectTrigger({
  children,
  label,
  title,
}: ComposerSelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      aria-label={label}
      title={title}
      render={
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-9 bg-transparent text-base md:size-7 md:text-sm [&_svg]:size-5 md:[&_svg]:size-4"
        />
      }
    >
      {children}
    </SelectPrimitive.Trigger>
  );
}
