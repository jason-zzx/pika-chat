"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delay = 300,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger<Payload = unknown>({
  ...props
}: TooltipPrimitive.Trigger.Props<Payload>) {
  return (
    <TooltipPrimitive.Trigger<Payload>
      data-slot="tooltip-trigger"
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        positionMethod="fixed"
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 block w-fit max-w-72 origin-(--transform-origin) rounded-lg bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 wrap-break-word data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

const sharedTooltipHandle = TooltipPrimitive.createHandle<React.ReactNode>()

function SharedTooltip({
  ...props
}: Omit<TooltipPrimitive.Trigger.Props<React.ReactNode>, "handle">) {
  return <TooltipTrigger handle={sharedTooltipHandle} {...props} />
}

function SharedTooltipHost() {
  return (
    <TooltipPrimitive.Root handle={sharedTooltipHandle}>
      {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
    </TooltipPrimitive.Root>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  SharedTooltip,
  SharedTooltipHost,
}
