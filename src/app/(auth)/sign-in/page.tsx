import { redirect } from "next/navigation";

import SignInForm from "@/components/auth/SignInForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export default async function SignInPage() {
  const state = await getInstanceState();
  if (state.needsSetup) {
    redirect("/setup");
  }

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <SignInForm allowRegistration={state.allowRegistration} />
    </main>
  );
}
