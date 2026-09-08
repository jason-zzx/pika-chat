"use client";

import { GlobeIcon } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { useSearchProviders } from "@/components/search/use-search-providers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SearchMode } from "@/lib/schemas/search-provider";
import { cn } from "@/lib/utils";
import { useComposerStore } from "@/stores/composer-store";

const SEARCH_MODE_OPTIONS: {
  value: SearchMode;
  label: string;
  description: string;
}[] = [
  { value: "off", label: "Off", description: "No web search." },
  {
    value: "builtin",
    label: "Model built-in",
    description:
      "Ask the model to use its own web search. Vendors without built-in search answer normally.",
  },
  {
    value: "tool",
    label: "Search tool",
    description: "The app searches the web via your configured providers.",
  },
];

// The mode is persisted in localStorage; the server snapshot keeps SSR HTML
// and the hydration render on the default until the store value applies.
const SERVER_SNAPSHOT: SearchMode = "off";

function subscribe(callback: () => void) {
  return useComposerStore.subscribe(callback);
}

function snapshot(): SearchMode {
  return useComposerStore.getState().searchMode;
}

function serverSnapshot(): SearchMode {
  return SERVER_SNAPSHOT;
}

type SearchModePickerProps = {
  disabled?: boolean;
};

export default function SearchModePicker({
  disabled = false,
}: SearchModePickerProps) {
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setSearchMode = useComposerStore((state) => state.setSearchMode);
  const providers = useSearchProviders();
  const toolAvailable = (providers.data?.providers.length ?? 0) > 0;
  const [open, setOpen] = useState(false);
  const modeLabel =
    SEARCH_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
    "Off";

  function select(next: SearchMode) {
    setSearchMode(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Web search mode"
        title={`Web search: ${modeLabel}`}
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            // bg-transparent matches the other pickers on the muted composer
            // container (outline variant defaults to bg-background).
            className="bg-transparent"
          />
        }
      >
        <GlobeIcon
          aria-hidden="true"
          className={cn(mode !== "off" && "text-primary")}
        />
        {mode !== "off" ? (
          <span className="text-xs">{modeLabel}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-2">
        {SEARCH_MODE_OPTIONS.map((option) => {
          const optionDisabled = option.value === "tool" && !toolAvailable;
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={optionDisabled}
              aria-pressed={selected}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                selected && "bg-accent text-accent-foreground",
              )}
              onClick={() => select(option.value)}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">
                {option.description}
              </span>
            </button>
          );
        })}
        {!toolAvailable ? (
          <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">
            No search providers configured.{" "}
            <Link
              href="/settings/search"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => setOpen(false)}
            >
              Add one in settings
            </Link>
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
