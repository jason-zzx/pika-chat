"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export default function DemoEntry() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onEnter() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.anonymous();
      if (result.error) {
        setError(
          result.error.code === "GUEST_IP_LIMIT"
            ? t("demo.ipLimitReached")
            : result.error.code === "IP_UNAVAILABLE"
              ? t("demo.ipUnavailable")
              : t("demo.enterFailed"),
        );
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(t("demo.enterFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("demo.description")}</p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="button" disabled={pending} onClick={() => void onEnter()}>
        {pending ? t("demo.entering") : t("demo.enter")}
      </Button>
    </div>
  );
}
