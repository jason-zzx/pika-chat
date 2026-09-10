"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { submitRegistration } from "@/lib/api/instance";

export default function SignUpForm() {
  const router = useRouter();
  const t = useTranslations("Auth");

  return (
    <CredentialsForm
      submitLabel={t("signUp.submit")}
      pendingLabel={t("signUp.submitting")}
      fallbackErrorKey="actions.register"
      onSubmit={async (input) => {
        await submitRegistration(input);
        router.push("/");
        router.refresh();
      }}
      footer={
        <p className="text-sm text-muted-foreground">
          {t("signUp.haveAccount")}{" "}
          <Link className="underline" href="/sign-in">
            {t("signUp.signInLink")}
          </Link>
        </p>
      }
    />
  );
}
