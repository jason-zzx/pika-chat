import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous, bearer, twoFactor, username } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { z } from "zod";

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
import { getEnv, isDemoMode, resolveTrustedOrigins } from "@/server/env";
import { logger } from "@/server/logger";
import { consumeDemoQuota } from "@/server/services/demo-usage.service";

const GUEST_BLOCKED_PATHS = new Set([
  "/update-user",
  "/change-password",
  "/change-email",
  "/delete-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/list-sessions",
  "/list-accounts",
  "/unlink-account",
]);

function demoBeforeHook(ipHeader: string) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-in/anonymous") {
      // Reject a missing request and missing, empty, or multi-value headers
      // even in dev/test (where getIP() falls back to 127.0.0.1 when header
      // parsing returns null).
      const ip =
        ctx.request &&
        z
          .union([z.ipv4(), z.ipv6()])
          .safeParse(ctx.request.headers.get(ipHeader)?.trim()).success
          ? getIP(ctx.request, ctx.context.options)
          : null;
      if (!ip) {
        logger.error(
          { header: ipHeader },
          "anonymous sign-in rejected: client IP could not be determined",
        );
        throw APIError.from("FORBIDDEN", {
          code: "IP_UNAVAILABLE",
          message: "Unable to determine client IP",
        });
      }
      // The plugin rejects a second anonymous sign-in from an existing guest
      // session; skip the quota so stale-tab clicks don't burn IP slots.
      const existing = await getSessionFromCtx<{ isAnonymous: boolean }>(ctx);
      if (existing?.user.isAnonymous) {
        return;
      }
      const allowed = await consumeDemoQuota({
        subject: `ip:${ip}`,
        kind: "guest",
        limit: getEnv().DEMO_GUESTS_PER_IP_DAILY,
      });
      if (!allowed) {
        logger.warn({ ip }, "anonymous sign-in rejected: daily IP quota exceeded");
        throw APIError.from("TOO_MANY_REQUESTS", {
          code: "GUEST_IP_LIMIT",
          message: "Too many demo sessions created from this IP today",
        });
      }
      return;
    }

    if (
      !GUEST_BLOCKED_PATHS.has(ctx.path) &&
      !ctx.path.startsWith("/two-factor/")
    ) {
      return;
    }
    const session = await getSessionFromCtx<{ isAnonymous: boolean }>(ctx);
    if (session?.user.isAnonymous) {
      throw APIError.from("FORBIDDEN", {
        code: "FORBIDDEN",
        message: "This action is not allowed for demo guests",
      });
    }
  });
}

export function createAuthInstance() {
  const demo = isDemoMode();
  const currentEnv = getEnv();
  const appUrl = currentEnv.APP_URL ?? "http://localhost:3000";
  const configuredTrustedOrigins = resolveTrustedOrigins(process.env);
  const trustedOrigins = Array.from(
    new Set([
      "http://localhost:3000",
      new URL(appUrl).origin,
      ...configuredTrustedOrigins,
    ]),
  );
  // instrumentation.ts refuses to boot DEMO_MODE without CLIENT_IP_HEADER;
  // it is only read inside the demo branches below.
  const ipHeader = currentEnv.CLIENT_IP_HEADER!;

  return betterAuth({
    appName: "Pika chat",
    baseURL: appUrl,
    secret: currentEnv.BETTER_AUTH_SECRET,
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
    ...(demo
      ? {
          databaseHooks: {
            user: {
              create: {
                // The anonymous plugin creates users without a username, but
                // `users.username` is NOT NULL.
                before: async (user) => {
                  if (user.isAnonymous !== true) {
                    return;
                  }
                  return {
                    data: {
                      ...user,
                      username: `guest-${newId().replaceAll("-", "").slice(0, 12)}`,
                    },
                  };
                },
              },
            },
          },
          hooks: {
            before: demoBeforeHook(ipHeader),
          },
        }
      : {}),
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
      ...(demo
        ? [
            anonymous({
              disableDeleteAnonymousUser: true,
              generateName: () =>
                `Guest-${newId().replaceAll("-", "").slice(0, 6)}`,
            }),
          ]
        : []),
      nextCookies(),
    ],
    advanced: {
      database: {
        generateId: () => newId(),
      },
      trustedProxyHeaders: true,
      ...(demo ? { ipAddress: { ipAddressHeaders: [ipHeader] } } : {}),
    },
    disabledPaths: ["/sign-up/email"],
    telemetry: {
      enabled: false,
    },
    trustedOrigins,
  });
}

export const auth = createAuthInstance();
