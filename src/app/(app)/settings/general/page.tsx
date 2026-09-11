import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import LocaleControl from "@/components/layout/LocaleControl";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import ThemeControl from "@/components/layout/ThemeControl";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsRow from "@/components/settings/SettingsRow";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";

export default async function SettingsGeneralPage() {
  const theme = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );
  const t = await getTranslations("Settings.General");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsCard>
        <div className="flex flex-col divide-y divide-border">
          <SettingsRow
            label={t("theme")}
            description={t("themeDescription")}
            control={<ThemeControl initialMode={theme.mode} />}
          />
          <SettingsRow
            label={t("language")}
            description={t("languageDescription")}
            control={<LocaleControl />}
          />
        </div>
      </SettingsCard>
    </PageContainer>
  );
}
