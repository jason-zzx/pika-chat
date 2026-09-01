import { headers } from "next/headers";
import { redirect } from "next/navigation";

import PageHeader from "@/components/layout/PageHeader";
import ProviderConfigsScreen from "@/components/provider/ProviderConfigsScreen";
import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export default async function SettingsProvidersPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }

  return (
    <>
      <PageHeader
        title="Providers"
        description="Connect OpenAI-compatible endpoints and choose which models chat can call."
      />
      <ProviderConfigsScreen canShare={isStaffRole(actor.role)} />
    </>
  );
}
