import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import SignInForm from "@/components/auth/SignInForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export default async function SignInPage() {
  const state = await getInstanceState();
  if (state.needsSetup) {
    redirect("/setup");
  }
  const t = await getTranslations("Auth");

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("signIn.title")}
      </h1>
      <SignInForm allowRegistration={state.allowRegistration} />
    </main>
  );
}
