import Link from "next/link";

import ChangePasswordForm from "@/components/account/ChangePasswordForm";

export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <ChangePasswordForm />
      <Link className="text-sm underline" href="/">
        Back
      </Link>
    </main>
  );
}
