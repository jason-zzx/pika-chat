"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  fetchInstanceState,
  updateInstanceSettings,
} from "@/lib/api/instance";

export default function RegistrationToggle() {
  const queryClient = useQueryClient();
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
      <h2 className="text-lg font-medium">Registration</h2>
      <p className="text-sm text-muted-foreground">
        {allowRegistration
          ? "Anyone with the link can create a user-role account."
          : "Only admins can create accounts."}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={settings.isPending || mutation.isPending}
        onClick={() => {
          mutation.mutate({ allowRegistration: !allowRegistration });
        }}
      >
        {allowRegistration ? "Disable registration" : "Enable registration"}
      </Button>
    </section>
  );
}
