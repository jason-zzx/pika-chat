import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import TwoFactorCard from "@/components/account/TwoFactorCard";
import PageHeader from "@/components/layout/PageHeader";
import { auth } from "@/server/auth";

export default async function SettingsAccountPage() {
  const t = await getTranslations("Account");
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ChangePasswordForm />
      <TwoFactorCard enabled={session?.user.twoFactorEnabled === true} />
    </>
  );
}
