import {
  AudioLinesIcon,
  BrainIcon,
  FileTextIcon,
  EyeIcon,
  TypeIcon,
  VideoIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { ProviderModel } from "@/lib/schemas/provider";
import { cn } from "@/lib/utils";

// Hoisted maps: modality tokens are data values, not copy.
const REASONING_LABEL = "reasoning";

// Same vision cue as the chat ModelPicker: an eye icon for image input.
const MODALITY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  text: TypeIcon,
  image: EyeIcon,
  audio: AudioLinesIcon,
  video: VideoIcon,
  pdf: FileTextIcon,
};

export function ModalityIcon({
  modality,
  className,
}: {
  modality: string;
  className?: string;
}) {
  const Icon = MODALITY_ICONS[modality];
  if (!Icon) {
    return null;
  }
  return <Icon className={className} />;
}

/**
 * Read-only capability glyphs for a model row: reasoning plus every non-text
 * input modality. Each icon carries its token as a tooltip/accessible label.
 */
export function ModelCapabilityIcons({
  model,
  className,
}: {
  model: ProviderModel;
  className?: string;
}) {
  const extras = model.inputModalities.filter(
    (modality) => modality !== "text",
  );
  if (!model.reasoning && extras.length === 0) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-muted-foreground",
        className,
      )}
    >
      {model.reasoning ? (
        <span title={REASONING_LABEL} aria-label={REASONING_LABEL}>
          <BrainIcon aria-hidden="true" className="size-3.5" />
        </span>
      ) : null}
      {extras.map((modality) => (
        <span key={modality} title={modality} aria-label={modality}>
          <ModalityIcon
            modality={modality}
            className="size-3.5"
          />
        </span>
      ))}
    </span>
  );
}
