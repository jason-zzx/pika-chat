"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  fetchInstanceState,
  updateInstanceSettings,
} from "@/lib/api/instance";

export default function RegistrationToggle() {
  const queryClient = useQueryClient();
  const t = useTranslations("Admin");
  const settings = useQuery({
    queryKey: ["instance"],
    queryFn: fetchInstanceState,
  });
  const mutation = useMutation({
    mutationFn: updateInstanceSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["instance"] });
    },
  });

  const allowRegistration = settings.data?.allowRegistration ?? false;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t("registrationTitle")}</h2>
      <p className="text-sm text-muted-foreground">
        {allowRegistration
          ? t("registrationOpen")
          : t("registrationClosed")}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={settings.isPending || mutation.isPending}
        onClick={() => {
          mutation.mutate({ allowRegistration: !allowRegistration });
        }}
      >
        {allowRegistration
          ? t("disableRegistration")
          : t("enableRegistration")}
      </Button>
    </section>
  );
}
