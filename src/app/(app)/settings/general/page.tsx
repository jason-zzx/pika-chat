import { cookies } from "next/headers";

import PageHeader from "@/components/layout/PageHeader";
import ThemeControl from "@/components/layout/ThemeControl";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";

export default async function SettingsGeneralPage() {
  const theme = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE_NAME)?.value,
  );

  return (
    <>
      <PageHeader
        title="General"
        description="Appearance for this browser."
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Theme</p>
        <ThemeControl initialMode={theme.mode} />
      </div>
    </>
  );
}
