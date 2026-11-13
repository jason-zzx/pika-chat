"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { signOutAndReset } from "@/lib/sign-out";

export default function SignOutButton() {
  const t = useTranslations("Auth");

  async function onClick() {
    // Full document replace: the previous account's caches, chat pool and
    // upload callbacks must not survive into the next session (chat task §7).
    // A failed sign-out must not look like one, so the error is surfaced and
    // the document stays where it is.
    try {
      await signOutAndReset();
    } catch {
      toast.add({ type: "error", title: t("signOutFailed") });
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onClick}>
      {t("signOut")}
    </Button>
  );
}
