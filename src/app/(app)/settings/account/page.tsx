import { useTranslations } from "next-intl";

import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import PageHeader from "@/components/layout/PageHeader";

export default function SettingsAccountPage() {
  const t = useTranslations("Account");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ChangePasswordForm />
    </>
  );
}
