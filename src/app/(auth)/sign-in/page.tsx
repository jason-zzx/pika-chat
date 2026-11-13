import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import DemoEntry from "@/components/auth/DemoEntry";
import SignInForm from "@/components/auth/SignInForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export const generateMetadata = async () => ({
  title: (await getTranslations("Auth"))("signIn.title"),
});

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ admin?: string }>;
}) {
  const state = await getInstanceState();
  if (state.needsSetup) {
    redirect("/setup");
  }
  const params = await searchParams;
  const showDemoEntry = state.demo && params.admin !== "1";
  const t = await getTranslations("Auth");

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {showDemoEntry ? t("demo.title") : t("signIn.title")}
      </h1>
      {showDemoEntry ? (
        <DemoEntry />
      ) : (
        <SignInForm allowRegistration={state.allowRegistration} />
      )}
    </main>
  );
}
