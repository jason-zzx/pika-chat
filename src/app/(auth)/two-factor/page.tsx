import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import TwoFactorForm from "@/components/auth/TwoFactorForm";
import { isChallengeCookie } from "@/lib/two-factor";

export default async function TwoFactorPage() {
  // Presence here is only a routing decision — authorization still happens
  // server-side in `/two-factor/verify-totp`.
  const names = (await cookies()).getAll().map((cookie) => cookie.name);
  if (!names.some(isChallengeCookie)) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Auth");

  return (
    <main className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("twoFactor.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("twoFactor.description")}
        </p>
      </div>
      <TwoFactorForm />
    </main>
  );
}
