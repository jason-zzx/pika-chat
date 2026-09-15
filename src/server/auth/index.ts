import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, bearer, twoFactor, username } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";

import { newId } from "@/lib/id";
import { roleHierarchy } from "@/server/auth/hierarchy";
import { getDb } from "@/server/db/client";
import {
  accounts,
  sessions,
  twoFactors,
  users,
  verifications,
} from "@/server/db/schema";
import { getEnv, resolveTrustedOrigins } from "@/server/env";

const env = getEnv();
const appUrl = env.APP_URL ?? "http://localhost:3000";
const configuredTrustedOrigins = resolveTrustedOrigins(process.env);

const trustedOrigins = Array.from(
  new Set([
    "http://localhost:3000",
    new URL(appUrl).origin,
    ...configuredTrustedOrigins,
  ]),
);

export const auth = betterAuth({
  appName: "Pika chat",
  baseURL: appUrl,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
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
    // TOTP-only: `otpOptions.sendOTP` stays unset (no email/SMS channel
    // exists), and `skipVerificationOnEnable` / `trustDeviceMaxAge` stay at
    // their defaults so enrollment always needs a confirmed code.
    twoFactor({ issuer: "Pika chat" }),
    nextCookies(),
  ],
  advanced: {
    database: {
      generateId: () => newId(),
    },
    trustedProxyHeaders: true,
  },
  disabledPaths: ["/sign-up/email"],
  telemetry: {
    enabled: false,
  },
  trustedOrigins,
});
