import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import LocaleControl from "@/components/layout/LocaleControl";
import PageHeader from "@/components/layout/PageHeader";
import ThemeControl from "@/components/layout/ThemeControl";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";

export default async function SettingsGeneralPage() {
  const theme = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );
  const t = await getTranslations("Settings.General");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("theme")}</p>
        <ThemeControl initialMode={theme.mode} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("language")}</p>
        <LocaleControl />
      </div>
    </>
  );
}
