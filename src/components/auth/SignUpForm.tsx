"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import CredentialsForm from "@/components/auth/CredentialsForm";
import { submitRegistration } from "@/lib/api/instance";

export default function SignUpForm() {
  const router = useRouter();

  return (
    <CredentialsForm
      submitLabel="Create account"
      pendingLabel="Creating…"
      fallbackError="Unable to register"
      onSubmit={async (input) => {
        await submitRegistration(input);
        router.push("/");
        router.refresh();
      }}
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      }
    />
  );
}
