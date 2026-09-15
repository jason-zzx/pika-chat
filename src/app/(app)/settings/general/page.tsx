import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import LocaleControl from "@/components/layout/LocaleControl";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import ThemeControl from "@/components/layout/ThemeControl";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsRow from "@/components/settings/SettingsRow";
import SettingsSection from "@/components/settings/SettingsSection";
import ThemePresetControl from "@/components/settings/ThemePresetControl";
import { resolveActor } from "@/server/auth/actor";
import { getUserThemePreference } from "@/server/services/user-preferences.service";

export default async function SettingsGeneralPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  // The DB is the theme source of truth for signed-in users.
  const themePreference = await getUserThemePreference(actor.userId);
  const t = await getTranslations("Settings.General");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsCard>
        <div className="flex flex-col divide-y divide-border">
          <SettingsRow
            label={t("theme")}
            description={t("themeDescription")}
            control={<ThemeControl initialPreference={themePreference} />}
          />
          <SettingsRow
            label={t("language")}
            description={t("languageDescription")}
            control={<LocaleControl />}
          />
        </div>
      </SettingsCard>
      <SettingsSection
        title={t("appearance")}
        description={t("appearanceDescription")}
      >
        <SettingsCard className="p-5">
          <ThemePresetControl initialPreference={themePreference} />
        </SettingsCard>
      </SettingsSection>
    </PageContainer>
  );
}
