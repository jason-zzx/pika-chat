import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import AdminUsersScreen from "@/components/admin/AdminUsersScreen";
import RegistrationToggle from "@/components/admin/RegistrationToggle";
import PageHeader from "@/components/layout/PageHeader";
import { resolveActor } from "@/server/auth/actor";

export default async function SettingsUsersPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Settings.Users");

  return (
    <>
      <PageHeader title={t("title")} />
      <RegistrationToggle />
      <AdminUsersScreen actor={actor} />
    </>
  );
}
