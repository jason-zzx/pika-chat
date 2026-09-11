"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  type Actor,
  canAdminister,
  parseActorRole,
} from "@/lib/auth-hierarchy";
import { authClient } from "@/lib/auth-client";

type AssignableRole = "admin" | "user";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  username?: string | null;
};

type AdminUsersScreenProps = {
  actor: Actor;
};

// Hoisted so JSX carries no bare string literal (i18next/no-literal-string).
const TONE_DESTRUCTIVE = "destructive";

async function listAdminUsers(): Promise<AdminUser[]> {
  const result = await authClient.admin.listUsers({
    query: { limit: 100 },
  });
  if (result.error) {
    // Key-based like the server error contract: never displayed verbatim.
    throw new Error("actions.listUsers");
  }
  return result.data.users;
}

export default function AdminUsersScreen({ actor }: AdminUsersScreenProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("Admin");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAdminUsers,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const createUser = useMutation({
    mutationFn: async (input: {
      username: string;
      email: string;
      password: string;
      role: AssignableRole;
    }) => {
      const result = await authClient.admin.createUser({
        email: input.email,
        password: input.password,
        name: input.username,
        role: input.role,
        data: { username: input.username },
      });
      if (result.error) {
        throw new Error("actions.createUser");
      }
    },
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: (caught) =>
      setError(apiErrorMessage(caught, tErrors, "actions.createUser")),
  });

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await createUser.mutateAsync({
      username: String(data.get("username") ?? ""),
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      role: String(data.get("role") ?? "user") === "admin" ? "admin" : "user",
    });
    form.reset();
  }

  async function onSetRole(userId: string, role: AssignableRole) {
    setError(null);
    const result = await authClient.admin.setRole({ userId, role });
    if (result.error) {
      setError(apiErrorMessage(result.error, tErrors, "actions.setRole"));
      return;
    }
    await invalidate();
  }

  async function onToggleBan(user: AdminUser) {
    setError(null);
    const result = user.banned
      ? await authClient.admin.unbanUser({ userId: user.id })
      : await authClient.admin.banUser({ userId: user.id });
    if (result.error) {
      setError(apiErrorMessage(result.error, tErrors, "actions.updateBan"));
      return;
    }
    await invalidate();
  }

  async function onResetPassword(userId: string) {
    const next = window.prompt(t("newPasswordPrompt"));
    if (!next) {
      return;
    }
    setError(null);
    const result = await authClient.admin.setUserPassword({
      userId,
      newPassword: next,
    });
    if (result.error) {
      setError(apiErrorMessage(result.error, tErrors, "actions.resetPassword"));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("createUserTitle")}>
        <SettingsCard className="p-5">
          <form
            onSubmit={onCreate}
            className="grid gap-3 sm:grid-cols-2"
          >
          <div className="flex flex-col gap-1">
            <Label htmlFor="create-username">{t("usernameLabel")}</Label>
            <Input id="create-username" name="username" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="create-email">{t("emailLabel")}</Label>
            <Input id="create-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="create-password">{t("passwordLabel")}</Label>
            <Input
              id="create-password"
              name="password"
              type="password"
              required
              minLength={8}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="create-role">{t("roleLabel")}</Label>
            <Select
              name="role"
              defaultValue="user"
              items={{ user: t("roleUser"), admin: t("roleAdmin") }}
            >
              <SelectTrigger id="create-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* eslint-disable-next-line i18next/no-literal-string -- select wire values, not copy */}
                <SelectItem value="user">{t("roleUser")}</SelectItem>
                {/* eslint-disable-next-line i18next/no-literal-string -- select wire values, not copy */}
                <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={createUser.isPending} className="w-fit">
            {createUser.isPending ? t("creating") : t("create")}
          </Button>
        </form>
        </SettingsCard>
      </SettingsSection>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {users.error ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(users.error, tErrors, "actions.listUsers")}
        </p>
      ) : null}

      <SettingsSection title={t("usersTitle")}>
        <ul className="flex flex-col gap-3">
          {(users.data ?? []).map((user) => {
            const target = {
              userId: user.id,
              role: parseActorRole(user.role),
            };
            const nextRole: AssignableRole =
              // eslint-disable-next-line i18next/no-literal-string -- role tokens (data values), not copy
              target.role === "admin" ? "user" : "admin";
            const showSetRole = canAdminister(
              actor,
              target,
              "set-role",
              nextRole,
            );
            const showBan = canAdminister(
              actor,
              target,
              user.banned ? "unban" : "ban",
            );
            const showReset = canAdminister(
              actor,
              target,
              "set-user-password",
            );
            const roleLabel =
              target.role === "super_admin"
                ? t("roleSuperAdmin")
                : target.role === "admin"
                  ? t("roleAdmin")
                  : t("roleUser");

            return (
              <li key={user.id}>
                <SettingsCard className="flex flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground"
                  >
                    {(user.username ?? user.name ?? user.email).charAt(0)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium">
                      {user.username ?? user.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {user.email}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <SettingsBadge dot={false}>{roleLabel}</SettingsBadge>
                      {user.banned ? (
                        <SettingsBadge tone={TONE_DESTRUCTIVE}>
                          {t("bannedBadge")}
                        </SettingsBadge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {showSetRole ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onSetRole(user.id, nextRole)}
                    >
                      {target.role === "admin"
                        ? t("makeUser")
                        : t("makeAdmin")}
                    </Button>
                  ) : null}
                  {showBan ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onToggleBan(user)}
                    >
                      {user.banned ? t("unban") : t("ban")}
                    </Button>
                  ) : null}
                  {showReset ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onResetPassword(user.id)}
                    >
                      {t("resetPassword")}
                    </Button>
                  ) : null}
                </div>
                </SettingsCard>
              </li>
            );
          })}
        </ul>
      </SettingsSection>
    </div>
  );
}
