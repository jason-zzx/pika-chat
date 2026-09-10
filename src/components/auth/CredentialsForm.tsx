"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import type { AppErrorMessageKey } from "@/lib/api/error-contract";
import type { CredentialsInput } from "@/lib/schemas/credentials";

type CredentialsFormProps = {
  submitLabel: string;
  pendingLabel: string;
  fallbackErrorKey: AppErrorMessageKey;
  footer?: ReactNode;
  onSubmit: (input: CredentialsInput) => Promise<void>;
};

export default function CredentialsForm({
  submitLabel,
  pendingLabel,
  fallbackErrorKey,
  footer,
  onSubmit,
}: CredentialsFormProps) {
  const t = useTranslations("Auth");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await onSubmit({
        username: String(form.get("username") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, fallbackErrorKey));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="username">{t("fields.username")}</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">{t("fields.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="password">{t("fields.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
