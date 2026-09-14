"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-transparent transition-colors outline-none",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* Hand edit inside generated shadcn/ui territory: the indicator renders
          for `indeterminate` too, so the glyph is chosen from state via the
          render prop (re-apply after any `shadcn` regen). */}
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center"
        render={(props, state) =>
          state.indeterminate ? (
            <MinusIcon {...props} className={cn(props.className, "size-3.5")} strokeWidth={3} />
          ) : (
            <CheckIcon {...props} className={cn(props.className, "size-3.5")} strokeWidth={3} />
          )
        }
      />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
