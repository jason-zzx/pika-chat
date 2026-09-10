"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import { authClient } from "@/lib/auth-client";
import { isTotpCode } from "@/lib/two-factor";

/** better-auth error codes that mean "this exact code was rejected". */
const INVALID_CODE_ERRORS = ["INVALID_CODE", "INVALID_BACKUP_CODE"];

export default function TwoFactorForm() {
  const router = useRouter();
  const t = useTranslations("Auth.twoFactor");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    try {
      // Shape-based dispatch: TOTP codes are six digits, backup codes always
      // carry a hyphen, so the two never collide.
      const result = isTotpCode(code)
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });
      if (result.error) {
        const errorCode = result.error.code;
        setError(
          errorCode !== undefined && INVALID_CODE_ERRORS.includes(errorCode)
            ? tErrors("auth.invalidTwoFactorCode")
            : apiErrorMessage(result.error, tErrors, "actions.verifyTwoFactor"),
        );
        return;
      }
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.verifyTwoFactor"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="twoFactorCode">{t("codeLabel")}</Label>
        <Input
          id="twoFactorCode"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
