"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SettingsBadge from "@/components/settings/SettingsBadge";
import type { AppErrorMessageKey } from "@/lib/api/error-contract";
import { apiErrorMessage } from "@/lib/api/error-message";
import { fetchTotpQrCode } from "@/lib/api/two-factor";
import { authClient } from "@/lib/auth-client";
import { copyTextToClipboard } from "@/lib/clipboard";

type TwoFactorCardProps = {
  enabled: boolean;
};

type EnrollPanelProps = {
  dataUrl: string | null;
  secret: string;
  pending: boolean;
  onCopySecret: () => void;
  onConfirm: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

type BackupCodeListProps = {
  codes: string[];
};

/** `otpauth://totp/…?secret=…` → the base32 secret, for manual entry. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function EnrollPanel({
  dataUrl,
  secret,
  pending,
  onCopySecret,
  onConfirm,
  onCancel,
}: EnrollPanelProps) {
  const t = useTranslations("Account.twoFactor");

  return (
    <>
      {dataUrl ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("qrCaption")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data-URL SVG
              rendered by our own endpoint; next/image cannot optimize one. */}
          <img
            src={dataUrl}
            alt={t("qrAlt")}
            className="size-44 rounded-lg border border-border bg-background p-2 shadow-xs"
          />
        </div>
      ) : null}
      {secret.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t("manualSecretLabel")}
          </p>
          <div className="flex items-center gap-2">
            <code className="thin-scrollbar min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopySecret}
            >
              {t("copySecret")}
            </Button>
          </div>
        </div>
      ) : null}
      <form onSubmit={onConfirm} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="twoFactorConfirmCode">{t("confirmLabel")}</Label>
          <Input
            id="twoFactorConfirmCode"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="max-w-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t("confirming") : t("confirmSubmit")}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </>
  );
}

function BackupCodeList({ codes }: BackupCodeListProps) {
  const t = useTranslations("Account.twoFactor");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4">
      <p className="font-medium text-sm">{t("backupCodesTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("backupCodesIntro")}</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <p className="text-sm text-destructive">{t("lossWarning")}</p>
    </div>
  );
}

export default function TwoFactorCard({ enabled }: TwoFactorCardProps) {
  const router = useRouter();
  const t = useTranslations("Account.twoFactor");
  const tErrors = useTranslations("Errors");
  // Card-local view state, seeded from the server-rendered flag and led by one
  // paint: `router.refresh()` re-reads the flag after a successful mutation,
  // but without this the just-confirmed card would flash the setup form again.
  const [view, setView] = useState<"off" | "enrolling" | "on">(
    enabled ? "on" : "off",
  );
  const [uri, setUri] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [heldCodes, setHeldCodes] = useState<string[] | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fail(caught: unknown, fallbackKey: AppErrorMessageKey): void {
    setError(apiErrorMessage(caught, tErrors, fallbackKey));
  }

  async function loadQrCode(totpUri: string): Promise<void> {
    try {
      const payload = await fetchTotpQrCode({ uri: totpUri });
      setDataUrl(payload.dataUrl);
    } catch (caught) {
      fail(caught, "actions.loadQrCode");
    }
  }

  async function onStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        fail(result.error, "actions.enableTwoFactor");
        return;
      }
      const data = result.data;
      if (!data || data.method !== "totp") {
        setError(tErrors("actions.enableTwoFactor"));
        return;
      }
      // `enable` returns the codes in plaintext, but the secret is unverified
      // until `verifyTotp` succeeds — hold them and reveal only after that.
      setHeldCodes(data.backupCodes);
      setUri(data.totpURI);
      setView("enrolling");
      form.reset();
      await loadQrCode(data.totpURI);
    } catch (caught) {
      fail(caught, "actions.enableTwoFactor");
    } finally {
      setPending(false);
    }
  }

  /**
   * AC9: sessions created before 2FA was enabled must not survive the switch,
   * and the server only rotates the session that confirmed enrollment. This
   * call is what signs the others out, so a failure has to be visible — a
   * silent one leaves other devices logged in without the second factor.
   */
  async function revokeOtherSessionsAfterEnable(): Promise<void> {
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        setError(t("otherSessionsNotRevoked"));
      }
    } catch {
      // Same outcome as a rejected call: the other sessions are still alive,
      // which must not be swallowed.
      setError(t("otherSessionsNotRevoked"));
    }
  }

  async function onConfirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(
          result.error.code === "INVALID_CODE"
            ? tErrors("auth.invalidTwoFactorCode")
            : apiErrorMessage(result.error, tErrors, "actions.verifyTwoFactor"),
        );
        return;
      }
      setCodes(heldCodes);
      setHeldCodes(null);
      setUri(null);
      setDataUrl(null);
      setView("on");
      form.reset();
      await revokeOtherSessionsAfterEnable();
      router.refresh();
    } catch (caught) {
      fail(caught, "actions.verifyTwoFactor");
    } finally {
      setPending(false);
    }
  }

  async function onRegenerate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    try {
      const result = await authClient.twoFactor.generateBackupCodes({
        password,
      });
      if (result.error) {
        fail(result.error, "actions.generateBackupCodes");
        return;
      }
      setCodes(result.data?.backupCodes ?? null);
      setNotice(t("codesRegenerated"));
      form.reset();
    } catch (caught) {
      fail(caught, "actions.generateBackupCodes");
    } finally {
      setPending(false);
    }
  }

  async function onDisable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        fail(result.error, "actions.disableTwoFactor");
        return;
      }
      setCodes(null);
      setHeldCodes(null);
      setView("off");
      setNotice(t("disabledDone"));
      form.reset();
      router.refresh();
    } catch (caught) {
      fail(caught, "actions.disableTwoFactor");
    } finally {
      setPending(false);
    }
  }

  async function onCopySecret(secret: string): Promise<void> {
    const copied = await copyTextToClipboard(secret);
    setNotice(copied ? t("secretCopied") : t("copyFailed"));
  }

  function onCancelEnrollment(): void {
    setUri(null);
    setDataUrl(null);
    setHeldCodes(null);
    setError(null);
    setView("off");
  }

  // Derived once: the enrollment panel both displays and copies this secret.
  const manualSecret = uri === null ? "" : secretFromUri(uri);
  const statusTone: "success" | "neutral" = view === "on" ? "success" : "neutral";

  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold tracking-tight">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <SettingsBadge tone={statusTone}>
          {view === "on" ? t("statusOn") : t("statusOff")}
        </SettingsBadge>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}

      {view === "off" ? (
        <form onSubmit={onStart} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="twoFactorStartPassword">{t("passwordLabel")}</Label>
            <Input
              id="twoFactorStartPassword"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="max-w-sm"
            />
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? t("working") : t("startSubmit")}
          </Button>
        </form>
      ) : null}

      {view === "enrolling" ? (
        <EnrollPanel
          dataUrl={dataUrl}
          secret={manualSecret}
          pending={pending}
          onCopySecret={() => void onCopySecret(manualSecret)}
          onConfirm={(event) => void onConfirm(event)}
          onCancel={onCancelEnrollment}
        />
      ) : null}

      {view === "on" ? (
        <>
          <form onSubmit={onRegenerate} className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t("regenerate")}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="twoFactorRegeneratePassword">
                {t("passwordLabel")}
              </Label>
              <Input
                id="twoFactorRegeneratePassword"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="max-w-sm"
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending} className="w-fit">
              {pending ? t("working") : t("regenerateSubmit")}
            </Button>
          </form>
          <form onSubmit={onDisable} className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t("disable")}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="twoFactorDisablePassword">{t("passwordLabel")}</Label>
              <Input
                id="twoFactorDisablePassword"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="max-w-sm"
              />
            </div>
            <Button type="submit" variant="destructive" disabled={pending} className="w-fit">
              {pending ? t("working") : t("disableSubmit")}
            </Button>
          </form>
        </>
      ) : null}

      {codes ? <BackupCodeList codes={codes} /> : null}
    </section>
  );
}
