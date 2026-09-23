"use client";

import { ImageIcon, InfoIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatRatioBound,
  freeformRules,
  validateFreeformSize,
  type ImageModelCapability,
} from "@/lib/image-capabilities";
import { cn } from "@/lib/utils";
import type { ComposerImageParams } from "@/stores/composer-store";

import ComposerPickerContent from "./ComposerPickerContent";

// Non-copy wire values (param field names, format example); hoisted so the
// i18next guard does not read them as rendered copy.
const PARAM_KEY_SIZE = "size";
const PARAM_KEY_QUALITY = "quality";
const PARAM_KEY_IMAGE_SIZE = "imageSize";
const CUSTOM_SIZE_PLACEHOLDER = "1024x768";

function ParamSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {hint}
      </div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Chip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs",
        active
          ? "border-transparent bg-accent text-accent-foreground"
          : "border-border hover:bg-accent/50",
      )}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

type ImageParamsPickerProps = {
  capability: ImageModelCapability;
  value: ComposerImageParams;
  onChange: (next: ComposerImageParams) => void;
  disabled?: boolean;
};

/**
 * Image-generation parameter popover shown in the composer when the picked
 * model advertises image output. Options come from the static capability
 * table; unset fields mean the provider default. The popup is portaled out
 * of the composer form, so Enter inside the custom-size input never submits.
 */
export default function ImageParamsPicker({
  capability,
  value,
  onChange,
  disabled = false,
}: ImageParamsPickerProps) {
  const t = useTranslations("Chat.Composer");
  // The popup unmounts on close, so this re-syncs from `value` on each open.
  const [customSize, setCustomSize] = useState(() =>
    value.size !== undefined && !capability.sizes.includes(value.size)
      ? value.size
      : "",
  );
  const customInvalid =
    customSize.trim().length > 0 &&
    !validateFreeformSize(customSize.trim(), capability.freeform);
  const n = value.n ?? 1;

  const sizeRules = freeformRules(capability.freeform);
  const sizeRulesText = sizeRules
    .map((rule) => {
      switch (rule.kind) {
        case "divisible":
          return t("imageRules.divisible", { n: rule.n });
        case "ratio":
          return t("imageRules.ratio", {
            min: formatRatioBound(rule.min),
            max: formatRatioBound(rule.max),
          });
        case "maxSide":
          return t("imageRules.maxSide", { n: rule.n });
        case "minSide":
          return t("imageRules.minSide", { n: rule.n });
        case "pixels":
          return t("imageRules.pixels", {
            min: rule.min.toLocaleString(),
            max: rule.max.toLocaleString(),
          });
      }
    })
    .join(" · ");

  function toggle(key: "size" | "quality" | "imageSize", option: string) {
    onChange({ ...value, [key]: value[key] === option ? undefined : option });
    if (key === "size") {
      setCustomSize("");
    }
  }

  function handleCustomSize(next: string) {
    setCustomSize(next);
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      onChange({ ...value, size: undefined });
    } else if (validateFreeformSize(trimmed, capability.freeform)) {
      // Invalid text stays local (flagged below) and never reaches a send.
      onChange({ ...value, size: trimmed });
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("imageParams")}
        title={t("imageParams")}
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            // bg-transparent matches the other pickers on the muted composer
            // container (outline variant defaults to bg-background).
            className="bg-transparent"
          />
        }
      >
        <ImageIcon aria-hidden="true" />
      </PopoverTrigger>
      <ComposerPickerContent className="w-72 gap-3">
        <ParamSection label={t("imageSize")}>
          {capability.sizes.map((option) => (
            <Chip
              key={option}
              label={option}
              active={value.size === option}
              onToggle={() => toggle(PARAM_KEY_SIZE, option)}
            />
          ))}
        </ParamSection>
        {capability.sizeMode === "freeform" ? (
          <ParamSection
            label={t("imageCustomSize")}
            hint={
              sizeRules.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label={t("imageRules.hint")}
                    className="inline-flex size-4 items-center justify-center rounded-md text-muted-foreground"
                  >
                    <InfoIcon aria-hidden="true" className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{sizeRulesText}</TooltipContent>
                </Tooltip>
              ) : null
            }
          >
            <Input
              value={customSize}
              placeholder={CUSTOM_SIZE_PLACEHOLDER}
              aria-label={t("imageCustomSize")}
              aria-invalid={customInvalid}
              autoComplete="off"
              className="h-8 w-full"
              onChange={(event) => handleCustomSize(event.target.value)}
            />
            {customInvalid ? (
              <p className="text-xs text-destructive">
                {t("imageCustomSizeInvalid")}
              </p>
            ) : null}
          </ParamSection>
        ) : null}
        {capability.nMax > 1 ? (
          <ParamSection label={t("imageCount")}>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label={t("imageCountDecrease")}
              title={t("imageCountDecrease")}
              disabled={disabled || n <= 1}
              onClick={() => onChange({ ...value, n: n - 1 })}
            >
              <MinusIcon aria-hidden="true" />
            </Button>
            <span className="min-w-6 text-center text-sm">{n}</span>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label={t("imageCountIncrease")}
              title={t("imageCountIncrease")}
              disabled={disabled || n >= capability.nMax}
              onClick={() => onChange({ ...value, n: n + 1 })}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </ParamSection>
        ) : null}
        {capability.qualities ? (
          <ParamSection label={t("imageQuality")}>
            {capability.qualities.map((option) => (
              <Chip
                key={option}
                label={option}
                active={value.quality === option}
                onToggle={() => toggle(PARAM_KEY_QUALITY, option)}
              />
            ))}
          </ParamSection>
        ) : null}
        {capability.imageSizes ? (
          <ParamSection label={t("imageResolution")}>
            {capability.imageSizes.map((option) => (
              <Chip
                key={option}
                label={option}
                active={value.imageSize === option}
                onToggle={() => toggle(PARAM_KEY_IMAGE_SIZE, option)}
              />
            ))}
          </ParamSection>
        ) : null}
      </ComposerPickerContent>
    </Popover>
  );
}
