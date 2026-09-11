import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import TwoFactorCard from "@/components/account/TwoFactorCard";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { auth } from "@/server/auth";

export default async function SettingsAccountPage() {
  const t = await getTranslations("Account");
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsSection
        title={t("passwordTitle")}
        description={t("passwordDescription")}
      >
        <SettingsCard className="p-5">
          <ChangePasswordForm />
        </SettingsCard>
      </SettingsSection>
      <TwoFactorCard enabled={session?.user.twoFactorEnabled === true} />
    </PageContainer>
  );
}
