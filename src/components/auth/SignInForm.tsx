"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SIGN_IN_FAILED_MESSAGE, authClient } from "@/lib/auth-client";

type SignInFormProps = {
  allowRegistration: boolean;
};

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

export default function SignInForm({ allowRegistration }: SignInFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get("identifier") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const result = looksLikeEmail(identifier)
        ? await authClient.signIn.email({ email: identifier, password })
        : await authClient.signIn.username({ username: identifier, password });
      if (result.error) {
        setError(SIGN_IN_FAILED_MESSAGE);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(SIGN_IN_FAILED_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="identifier">Username or email</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {allowRegistration ? (
        <p className="text-sm text-muted-foreground">
          Need an account?{" "}
          <Link className="underline" href="/sign-up">
            Create one
          </Link>
        </p>
      ) : null}
    </form>
  );
}
