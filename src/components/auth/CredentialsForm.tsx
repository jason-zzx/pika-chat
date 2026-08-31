"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/error-message";
import type { CredentialsInput } from "@/lib/schemas/credentials";

type CredentialsFormProps = {
  submitLabel: string;
  pendingLabel: string;
  fallbackError: string;
  footer?: ReactNode;
  onSubmit: (input: CredentialsInput) => Promise<void>;
};

export default function CredentialsForm({
  submitLabel,
  pendingLabel,
  fallbackError,
  footer,
  onSubmit,
}: CredentialsFormProps) {
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
      setError(apiErrorMessage(caught, fallbackError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Username
        <input
          name="username"
          autoComplete="username"
          required
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
