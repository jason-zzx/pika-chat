"use client";

import { adminClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const SIGN_IN_FAILED_MESSAGE =
  "Invalid username, email, or password";

export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient()],
});
