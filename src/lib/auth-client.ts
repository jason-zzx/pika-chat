"use client";

import { adminClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { AppErrorMessageKey } from "@/lib/api/error-contract";

/**
 * Fallback `Errors` key for a rejected sign-in. better-auth errors are not our
 * API envelope, so `apiErrorMessage` resolves them to this key.
 */
export const SIGN_IN_FAILED_KEY: AppErrorMessageKey = "auth.signInFailed";

export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient()],
});
