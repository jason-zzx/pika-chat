"use client";

import { useRouter } from "next/navigation";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { submitSetup } from "@/lib/api/instance";

export default function SetupForm() {
  const router = useRouter();

  return (
    <CredentialsForm
      submitLabel="Create admin account"
      pendingLabel="Creating…"
      fallbackError="Unable to complete setup"
      onSubmit={async (input) => {
        await submitSetup(input);
        router.push("/");
        router.refresh();
      }}
    />
  );
}
