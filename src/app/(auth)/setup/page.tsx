import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import SetupForm from "@/components/auth/SetupForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export default async function SetupPage() {
  const state = await getInstanceState();
  if (!state.needsSetup) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Auth");

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("setup.title")}
      </h1>
      <p className="text-sm text-muted-foreground">{t("setup.description")}</p>
      <SetupForm />
    </main>
  );
}
