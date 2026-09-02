import { redirect } from "next/navigation";

import SetupForm from "@/components/auth/SetupForm";
import { getInstanceState } from "@/server/services/instance-settings.service";

export default async function SetupPage() {
  const state = await getInstanceState();
  if (!state.needsSetup) {
    redirect("/sign-in");
  }

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Set up Pika chat</h1>
      <p className="text-sm text-muted-foreground">
        Create the first admin account for this instance.
      </p>
      <SetupForm />
    </main>
  );
}
