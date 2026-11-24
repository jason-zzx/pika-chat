"use client";

import { GlobeIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { useSearchProviders } from "@/components/search/use-search-providers";
import { useIsGuest } from "@/hooks/use-is-guest";
import { usePikaNative } from "@/hooks/use-pika-native";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SharedTooltip } from "@/components/ui/tooltip";
import type { SearchMode } from "@/lib/schemas/search-provider";
import { cn } from "@/lib/utils";
import { useComposerStore } from "@/stores/composer-store";

import ComposerPickerContent from "./ComposerPickerContent";

type SearchModeOptionKey =
  | "searchMode.off"
  | "searchMode.builtin"
  | "searchMode.tool";

const SEARCH_MODE_OPTIONS: {
  value: SearchMode;
  labelKey: SearchModeOptionKey;
  descriptionKey: `${SearchModeOptionKey}Description`;
}[] = [
  {
    value: "off",
    labelKey: "searchMode.off",
    descriptionKey: "searchMode.offDescription",
  },
  {
    value: "builtin",
    labelKey: "searchMode.builtin",
    descriptionKey: "searchMode.builtinDescription",
  },
  {
    value: "tool",
    labelKey: "searchMode.tool",
    descriptionKey: "searchMode.toolDescription",
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
  const t = useTranslations("Chat.Pickers");
  const isNative = usePikaNative() !== null;
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setSearchMode = useComposerStore((state) => state.setSearchMode);
  const isGuest = useIsGuest();
  const providers = useSearchProviders(!isGuest);
  // Guests inherit the operator's search providers, which `/api/search-providers`
  // does not expose to them (403); the backend gracefully degrades to tool-less
  // if the operator has none configured.
  const toolAvailable = isGuest || (providers.data?.providers.length ?? 0) > 0;
  const [open, setOpen] = useState(false);
  const modeLabel = t(
    SEARCH_MODE_OPTIONS.find((option) => option.value === mode)?.labelKey ??
      "searchMode.off",
  );

  function select(next: SearchMode) {
    setSearchMode(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SharedTooltip
        payload={t("searchMode.toggleTitle", { mode: modeLabel })}
        render={
          <PopoverTrigger
            aria-label={t("searchMode.toggleLabel", { mode: modeLabel })}
            disabled={disabled}
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className={cn(
                  "size-9 bg-transparent md:size-7 [&_svg]:size-5 md:[&_svg]:size-4",
                  // Active: highlight the icon itself in primary (near-black in
                  // light mode) instead of filling the button; inactive is a
                  // lighter muted tint.
                  mode === "off"
                    ? "text-muted-foreground/70"
                    : "text-primary hover:text-primary aria-expanded:text-primary",
                )}
              />
            }
          />
        }
      >
        {mode === "builtin" ? (
          <SearchIcon aria-hidden="true" />
        ) : (
          <GlobeIcon aria-hidden="true" />
        )}
      </SharedTooltip>
      <ComposerPickerContent className="w-80 gap-1">
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
                "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 md:gap-0.5 md:px-2 md:py-1.5",
                selected && "bg-accent text-accent-foreground",
              )}
              onClick={() => select(option.value)}
            >
              <span className="text-base font-medium md:text-sm">
                {t(option.labelKey)}
              </span>
              <span className="text-sm text-muted-foreground md:text-xs">
                {t(option.descriptionKey)}
              </span>
            </button>
          );
        })}
        {!toolAvailable ? (
          <p className="px-2.5 pt-1 pb-1 text-sm text-muted-foreground md:px-2 md:text-xs">
            {t("searchMode.noProviders")}{" "}
            <Link
              href="/settings/search"
              replace={isNative}
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => setOpen(false)}
            >
              {t("searchMode.addProvider")}
            </Link>
          </p>
        ) : null}
      </ComposerPickerContent>
    </Popover>
  );
}
