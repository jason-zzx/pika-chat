"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  DEFAULT_PROVIDER_API_FORMAT,
  isProviderApiFormat,
  PROVIDER_API_FORMATS,
  PROVIDER_FORMAT_DEFAULTS,
  requiresApiKey,
  type ProviderApiFormat,
} from "@/lib/provider-format";
import type {
  CreateProviderConfigInput,
  OwnProviderConfig,
} from "@/lib/schemas/provider";

/** Keys under the `Provider` namespace; the labels themselves are catalog copy. */
export const PROVIDER_FORMAT_LABEL_KEYS = {
  "openai-compatible": "formatOpenai",
  claude: "formatClaude",
  google: "formatGoogle",
} as const satisfies Record<ProviderApiFormat, string>;

type ProviderConfigFormProps = {
  canShare: boolean;
  pending: boolean;
  submitLabel: string;
  idPrefix: string;
  initial?: Pick<
    OwnProviderConfig,
    "name" | "baseUrl" | "apiFormat" | "visibility"
  >;
  onSubmit: (input: CreateProviderConfigInput) => Promise<void>;
};

export default function ProviderConfigForm({
  canShare,
  pending,
  submitLabel,
  idPrefix,
  initial,
  onSubmit,
}: ProviderConfigFormProps) {
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const isEdit = initial !== undefined;
  const [format, setFormat] = useState<ProviderApiFormat>(
    initial?.apiFormat ?? DEFAULT_PROVIDER_API_FORMAT,
  );
  const [error, setError] = useState<string | null>(null);
  const formatDefaults = PROVIDER_FORMAT_DEFAULTS[format];
  const apiKeyRequired = requiresApiKey(format);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const baseUrlRaw = String(data.get("baseUrl") ?? "").trim();
    const apiKeyRaw = String(data.get("apiKey") ?? "");
    const shared = data.get("shared") === "on";
    const input: CreateProviderConfigInput = {
      name,
      // An empty field means "use this format's endpoint", so the default only
      // has to be reachable — it does not have to be pre-filled.
      baseUrl:
        baseUrlRaw.length > 0 ? baseUrlRaw : formatDefaults.defaultBaseUrl,
      apiFormat: format,
      visibility: shared ? "shared" : "private",
    };
    if (apiKeyRaw.length > 0) {
      input.apiKey = apiKeyRaw;
    } else if (!isEdit) {
      input.apiKey = null;
    }
    setError(null);
    try {
      await onSubmit(input);
      if (!isEdit) {
        form.reset();
        setFormat(DEFAULT_PROVIDER_API_FORMAT);
      }
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.saveProvider"));
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-lg flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-name`}>{t("nameLabel")}</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          defaultValue={initial?.name}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-api-format`}>{t("apiFormatLabel")}</Label>
        <Select
          value={format}
          onValueChange={(next) => {
            if (typeof next === "string" && isProviderApiFormat(next)) {
              setFormat(next);
            }
          }}
        >
          <SelectTrigger id={`${idPrefix}-api-format`} className="w-full">
            <SelectValue>{t(PROVIDER_FORMAT_LABEL_KEYS[format])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_API_FORMATS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(PROVIDER_FORMAT_LABEL_KEYS[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-base-url`}>{t("baseUrlLabel")}</Label>
        <Input
          id={`${idPrefix}-base-url`}
          name="baseUrl"
          type="url"
          placeholder={formatDefaults.defaultBaseUrl}
          defaultValue={initial?.baseUrl}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-api-key`}>{t("apiKeyLabel")}</Label>
        <Input
          id={`${idPrefix}-api-key`}
          name="apiKey"
          type="password"
          autoComplete="off"
          required={apiKeyRequired && !isEdit}
          placeholder={
            isEdit
              ? t("apiKeyEditPlaceholder")
              : apiKeyRequired
                ? t("apiKeyRequiredPlaceholder")
                : t("apiKeyNewPlaceholder")
          }
        />
      </div>
      {canShare ? (
        <div className="flex items-center gap-2">
          <Checkbox
            name="shared"
            defaultChecked={initial?.visibility === "shared"}
            aria-label={t("shareWithInstance")}
          />
          <span className="text-sm">{t("shareWithInstance")}</span>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending} className="mt-1 w-fit">
        {pending ? t("saving") : submitLabel}
      </Button>
    </form>
  );
}
