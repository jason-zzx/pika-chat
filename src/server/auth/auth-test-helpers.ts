import "server-only";

import { GET as authGet, POST as authPost } from "@/app/api/auth/[...all]/route";
import { GET as getInstance } from "@/app/api/instance/route";
import { POST as postRegistration } from "@/app/api/registration/route";
import { POST as postSetup } from "@/app/api/setup/route";
import {
  PATCH as patchAdminSettings,
} from "@/app/api/admin/settings/route";

export const ORIGIN = "http://localhost:3000";

export const adminCredentials = {
  username: "operator",
  email: "admin@example.com",
  password: "password1",
};

export const userCredentials = {
  username: "member",
  email: "member@example.com",
  password: "password1",
};

export const staffAdminCredentials = {
  username: "staffadmin",
  email: "staffadmin@example.com",
  password: "password1",
};

export const otherAdminCredentials = {
  username: "otheradmin",
  email: "otheradmin@example.com",
  password: "password1",
};

export function jsonRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    bearer?: string;
  } = {},
): Request {
  const headers = new Headers({ origin: ORIGIN });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.bearer) {
    headers.set("authorization", `Bearer ${options.bearer}`);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

export { authGet, authPost, getInstance, postRegistration, postSetup, patchAdminSettings };
