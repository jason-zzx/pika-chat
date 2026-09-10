import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import SignUpForm from "@/components/auth/SignUpForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export default async function SignUpPage() {
  const state = await getInstanceState();
  if (state.needsSetup) {
    redirect("/setup");
  }
  if (!state.allowRegistration) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Auth");

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("signUp.title")}
      </h1>
      <SignUpForm />
    </main>
  );
}
