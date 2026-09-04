import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, bearer, username } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";

import { newId } from "@/lib/id";
import { roleHierarchy } from "@/server/auth/hierarchy";
import { getDb } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { getEnv } from "@/server/env";

const env = getEnv();

export const auth = betterAuth({
  appName: "Pika chat",
  baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    username(),
    bearer(),
    admin({
      defaultRole: "user",
      adminRoles: ["super_admin", "admin"],
      roles: {
        super_admin: adminAc,
        admin: adminAc,
        user: userAc,
      },
    }),
    roleHierarchy(),
    nextCookies(),
  ],
  advanced: {
    database: {
      generateId: () => newId(),
    },
  },
  disabledPaths: ["/sign-up/email"],
  telemetry: {
    enabled: false,
  },
  trustedOrigins: [
    "http://localhost:3000",
    "http://192.168.99.203:3000"
  ],
});
