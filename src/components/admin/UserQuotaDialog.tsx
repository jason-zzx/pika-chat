"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import { fetchUserQuota, updateUserQuota } from "@/lib/api/user-quota";
import { BYTES_PER_MB } from "@/lib/files/constants";
import { parseQuotaMb } from "@/lib/files/quota-input";

const INPUT_ID = "user-storage-quota-mb";

type UserQuotaDialogProps = {
  userId: string;
  label: string;
  onOpenChange: (open: boolean) => void;
};

/**
 * Per-user attachment storage quota override. The parent mounts this only
 * while a target is selected and keys it by user id, so the draft starts blank
 * and is seeded from the fetched override without any open/close bookkeeping.
 * The value is loaded here because Better Auth's user list does not carry
 * custom columns.
 */
export default function UserQuotaDialog({
  userId,
  label,
  onOpenChange,
}: UserQuotaDialogProps) {
  const t = useTranslations("Admin");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [synced, setSynced] = useState<number | null | undefined>(undefined);
  const quota = useQuery({
    queryKey: ["admin-user-quota", userId],
    queryFn: () => fetchUserQuota(userId),
  });
  const mutation = useMutation({
    mutationFn: (quotaMb: number | null) => updateUserQuota(userId, quotaMb),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin-user-quota", userId],
      });
      onOpenChange(false);
    },
  });

  // Render-time state adjustment rather than an effect (see
  // react-hooks/set-state-in-effect): seed the draft once the override lands.
  if (quota.data !== undefined && quota.data.quotaBytes !== synced) {
    setSynced(quota.data.quotaBytes);
    setValue(
      quota.data.quotaBytes === null
        ? ""
        : String(quota.data.quotaBytes / BYTES_PER_MB),
    );
  }

  const parsed = parseQuotaMb(value);
  const canSave =
    parsed !== undefined && !quota.isPending && !mutation.isPending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed === undefined) {
      return;
    }
    await mutation.mutateAsync(parsed);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("quotaTitle", { name: label })}</DialogTitle>
          <DialogDescription>{t("quotaDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={INPUT_ID}>{t("quotaLabel")}</Label>
            <Input
              id={INPUT_ID}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={value}
              placeholder={t("quotaFollowDefault")}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          {quota.error || mutation.error ? (
            <p className="text-sm text-destructive">
              {apiErrorMessage(
                mutation.error ?? quota.error,
                tErrors,
                mutation.error
                  ? "actions.saveStorageQuota"
                  : "actions.loadStorageQuota",
              )}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={!canSave}>
              {mutation.isPending ? t("quotaSaving") : t("quotaSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
