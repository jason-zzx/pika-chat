"use client";

import { useTranslations } from "next-intl";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { useAppNavigation } from "@/components/providers/NavigationProvider";
import { submitSetup } from "@/lib/api/instance";

export default function SetupForm() {
  const appNav = useAppNavigation();
  const t = useTranslations("Auth");

  return (
    <CredentialsForm
      submitLabel={t("setup.submit")}
      pendingLabel={t("setup.submitting")}
      fallbackErrorKey="actions.completeSetup"
      onSubmit={async (input) => {
        await submitSetup(input);
        appNav.completeAuth();
      }}
    />
  );
}
