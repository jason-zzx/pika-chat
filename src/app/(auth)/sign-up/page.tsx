import { redirect } from "next/navigation";

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

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <SignUpForm />
    </main>
  );
}
