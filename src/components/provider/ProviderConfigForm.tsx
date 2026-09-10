"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import type {
  CreateProviderConfigInput,
  OwnProviderConfig,
} from "@/lib/schemas/provider";

type ProviderConfigFormProps = {
  canShare: boolean;
  pending: boolean;
  submitLabel: string;
  idPrefix: string;
  initial?: Pick<OwnProviderConfig, "name" | "baseUrl" | "visibility">;
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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const baseUrl = String(data.get("baseUrl") ?? "").trim();
    const apiKeyRaw = String(data.get("apiKey") ?? "");
    const shared = data.get("shared") === "on";
    const input: CreateProviderConfigInput = {
      name,
      baseUrl,
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
      }
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.saveProvider"));
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-lg flex-col gap-2">
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
        <Label htmlFor={`${idPrefix}-base-url`}>{t("baseUrlLabel")}</Label>
        <Input
          id={`${idPrefix}-base-url`}
          name="baseUrl"
          type="url"
          required
          placeholder={t("baseUrlPlaceholder")}
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
          placeholder={
            isEdit
              ? t("apiKeyEditPlaceholder")
              : t("apiKeyNewPlaceholder")
          }
        />
      </div>
      {canShare ? (
        <Label className="gap-2 font-normal">
          <input
            type="checkbox"
            name="shared"
            defaultChecked={initial?.visibility === "shared"}
            className="size-4 accent-primary"
          />
          {t("shareWithInstance")}
        </Label>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : submitLabel}
      </Button>
    </form>
  );
}
