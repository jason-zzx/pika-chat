export const MODEL_VENDOR_KEYS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "alibaba",
  "zhipuai",
  "moonshotai",
  "meta",
  "mistral",
  "xai",
  "sensenova",
] as const;

export type ModelVendorKey = (typeof MODEL_VENDOR_KEYS)[number];

export const MODEL_VENDOR_LABELS: Record<ModelVendorKey, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  alibaba: "Qwen",
  zhipuai: "Zhipu",
  moonshotai: "Moonshot",
  meta: "Meta",
  mistral: "Mistral",
  xai: "xAI",
  sensenova: "SenseNova",
};

const CATALOG_PROVIDER_ALIASES: Record<string, ModelVendorKey> = {
  openai: "openai",
  azure: "openai",
  anthropic: "anthropic",
  google: "google",
  "google-vertex": "google",
  gemini: "google",
  deepseek: "deepseek",
  alibaba: "alibaba",
  qwen: "alibaba",
  zhipuai: "zhipuai",
  zai: "zhipuai",
  "z-ai": "zhipuai",
  "zhipuai-coding-plan": "zhipuai",
  "zai-coding-plan": "zhipuai",
  moonshotai: "moonshotai",
  moonshot: "moonshotai",
  meta: "meta",
  mistral: "mistral",
  xai: "xai",
  grok: "xai",
  sensenova: "sensenova",
};

const VENDOR_RULES: ReadonlyArray<{ test: RegExp; vendor: ModelVendorKey }> = [
  { test: /claude/i, vendor: "anthropic" },
  { test: /gemini|gemma/i, vendor: "google" },
  { test: /deepseek/i, vendor: "deepseek" },
  { test: /qwen|qwq|tongyi/i, vendor: "alibaba" },
  { test: /glm|chatglm/i, vendor: "zhipuai" },
  { test: /kimi|moonshot/i, vendor: "moonshotai" },
  { test: /sensenova|sensetime|sensecore/i, vendor: "sensenova" },
  { test: /llama/i, vendor: "meta" },
  { test: /mistral|mixtral|codestral/i, vendor: "mistral" },
  { test: /grok/i, vendor: "xai" },
  { test: /gpt-|chatgpt|^o[1-9]|davinci/i, vendor: "openai" },
];

export function isModelVendorKey(value: string): value is ModelVendorKey {
  return (MODEL_VENDOR_KEYS as readonly string[]).includes(value);
}

export function isCatalogFirstPartyProvider(providerId: string): boolean {
  return Object.hasOwn(CATALOG_PROVIDER_ALIASES, providerId.toLowerCase());
}

export function vendorKeyFromModelId(modelId: string): ModelVendorKey | null {
  for (const rule of VENDOR_RULES) {
    if (rule.test.test(modelId)) {
      return rule.vendor;
    }
  }
  return null;
}

export function vendorKeyFromCatalogProvider(
  providerId: string,
  modelId: string,
): ModelVendorKey | null {
  const mapped = CATALOG_PROVIDER_ALIASES[providerId.toLowerCase()];
  if (mapped) {
    return mapped;
  }
  return vendorKeyFromModelId(modelId);
}

export function resolvedVendorKey(
  stored: string | null,
  modelId: string,
): string | null {
  if (stored && isModelVendorKey(stored)) {
    return stored;
  }
  return vendorKeyFromModelId(modelId);
}

export function formatContextTokens(tokens: number): string | null {
  return tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : null;
}

export function modelHasVision(inputModalities: string[]): boolean {
  return inputModalities.some(
    (modality) => modality === "image" || modality === "vision",
  );
}
