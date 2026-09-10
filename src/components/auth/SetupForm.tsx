"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { submitSetup } from "@/lib/api/instance";

export default function SetupForm() {
  const router = useRouter();
  const t = useTranslations("Auth");

  return (
    <CredentialsForm
      submitLabel={t("setup.submit")}
      pendingLabel={t("setup.submitting")}
      fallbackErrorKey="actions.completeSetup"
      onSubmit={async (input) => {
        await submitSetup(input);
        router.push("/");
        router.refresh();
      }}
    />
  );
}
