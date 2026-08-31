import { headers } from "next/headers";
import Link from "next/link";

import SignOutButton from "@/components/auth/SignOutButton";
import { isStaffRole, parseActorRole } from "@/lib/auth-hierarchy";
import { auth } from "@/server/auth";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.banned === true) {
    return null;
  }

  const role = parseActorRole(session.user.role);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">pika-chat</h1>
      <p className="text-muted-foreground">
        Signed in as {session.user.username ?? session.user.email}
      </p>
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link className="underline" href="/account">
          Change password
        </Link>
        {isStaffRole(role) ? (
          <Link className="underline" href="/admin/users">
            Manage users
          </Link>
        ) : null}
      </nav>
      <SignOutButton />
    </main>
  );
}
