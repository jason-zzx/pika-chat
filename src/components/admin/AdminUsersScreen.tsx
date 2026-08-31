"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
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

async function listAdminUsers(): Promise<AdminUser[]> {
  const result = await authClient.admin.listUsers({
    query: { limit: 100 },
  });
  if (result.error) {
    throw new Error("Unable to list users");
  }
  return result.data.users;
}

export default function AdminUsersScreen({ actor }: AdminUsersScreenProps) {
  const queryClient = useQueryClient();
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
        throw new Error("Unable to create user");
      }
    },
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: () => setError("Unable to create user"),
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
      setError("Unable to change role");
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
      setError("Unable to update ban");
      return;
    }
    await invalidate();
  }

  async function onResetPassword(userId: string) {
    const next = window.prompt("New password (min 8 characters)");
    if (!next) {
      return;
    }
    setError(null);
    const result = await authClient.admin.setUserPassword({
      userId,
      newPassword: next,
    });
    if (result.error) {
      setError("Unable to reset password");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Create user</h2>
        <form onSubmit={onCreate} className="flex max-w-lg flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Username
            <input
              name="username"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              name="email"
              type="email"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              name="role"
              defaultValue="user"
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <Button type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {users.error ? (
        <p className="text-sm text-destructive">Unable to list users</p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Users</h2>
        <ul className="flex flex-col gap-3">
          {(users.data ?? []).map((user) => {
            const target = {
              userId: user.id,
              role: parseActorRole(user.role),
            };
            const nextRole: AssignableRole =
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

            return (
              <li
                key={user.id}
                className="flex flex-col gap-2 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium">{user.username ?? user.name}</p>
                  <p className="text-muted-foreground">{user.email}</p>
                  <p>
                    {user.role ?? "user"}
                    {user.banned ? " · banned" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {showSetRole ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onSetRole(user.id, nextRole)}
                    >
                      {target.role === "admin" ? "Make user" : "Make admin"}
                    </Button>
                  ) : null}
                  {showBan ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onToggleBan(user)}
                    >
                      {user.banned ? "Unban" : "Ban"}
                    </Button>
                  ) : null}
                  {showReset ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onResetPassword(user.id)}
                    >
                      Reset password
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
