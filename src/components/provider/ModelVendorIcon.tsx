import {
  isModelVendorKey,
  type ModelVendorKey,
  resolvedVendorKey,
} from "@/lib/model-vendor";
import { cn } from "@/lib/utils";

import {
  AlibabaMark,
  AnthropicMark,
  DeepseekMark,
  GoogleMark,
  MetaMark,
  MistralMark,
  MoonshotaiMark,
  OpenaiMark,
  SensenovaMark,
  XaiMark,
  ZhipuaiMark,
} from "./vendor-icons/marks";

type ModelVendorIconProps = {
  modelId: string;
  vendorKey: string | null;
  className?: string;
};

function VendorGlyph({ vendor }: { vendor: ModelVendorKey }) {
  switch (vendor) {
    case "openai":
      return <OpenaiMark />;
    case "anthropic":
      return <AnthropicMark />;
    case "google":
      return <GoogleMark />;
    case "deepseek":
      return <DeepseekMark />;
    case "alibaba":
      return <AlibabaMark />;
    case "zhipuai":
      return <ZhipuaiMark />;
    case "moonshotai":
      return <MoonshotaiMark />;
    case "meta":
      return <MetaMark />;
    case "mistral":
      return <MistralMark />;
    case "xai":
      return <XaiMark />;
    case "sensenova":
      return <SensenovaMark />;
  }
}

function GenericMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-foreground"
    >
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export default function ModelVendorIcon({
  modelId,
  vendorKey,
  className,
}: ModelVendorIconProps) {
  const resolved = resolvedVendorKey(vendorKey, modelId);
  return (
    <span className={cn("inline-flex", className)}>
      {resolved && isModelVendorKey(resolved) ? (
        <VendorGlyph vendor={resolved} />
      ) : (
        <GenericMark />
      )}
    </span>
  );
}
