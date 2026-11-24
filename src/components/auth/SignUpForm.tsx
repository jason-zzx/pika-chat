"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { useAppNavigation } from "@/components/providers/NavigationProvider";
import { submitRegistration } from "@/lib/api/instance";

export default function SignUpForm() {
  const appNav = useAppNavigation();
  const t = useTranslations("Auth");

  return (
    <CredentialsForm
      submitLabel={t("signUp.submit")}
      pendingLabel={t("signUp.submitting")}
      fallbackErrorKey="actions.register"
      onSubmit={async (input) => {
        await submitRegistration(input);
        appNav.completeAuth();
      }}
      footer={
        <p className="text-sm text-muted-foreground">
          {t("signUp.haveAccount")}{" "}
          <Link className="underline" href="/sign-in" replace>
            {t("signUp.signInLink")}
          </Link>
        </p>
      }
    />
  );
}
