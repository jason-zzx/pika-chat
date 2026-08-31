import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import AdminUsersScreen from "@/components/admin/AdminUsersScreen";
import RegistrationToggle from "@/components/admin/RegistrationToggle";
import { resolveActor } from "@/server/auth/actor";

export default async function AdminUsersPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <Link className="text-sm underline" href="/">
          Back
        </Link>
      </div>
      <RegistrationToggle />
      <AdminUsersScreen actor={actor} />
    </main>
  );
}
