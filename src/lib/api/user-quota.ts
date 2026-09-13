import { parseJson } from "@/lib/api/parse";
import {
  userQuotaResponseSchema,
  type UserQuotaResponse,
} from "@/lib/schemas/user-quota";

function quotaUrl(userId: string): string {
  return `/api/admin/users/${encodeURIComponent(userId)}/quota`;
}

/** Reads a user's storage quota override (null = follow the global default). */
export async function fetchUserQuota(
  userId: string,
): Promise<UserQuotaResponse> {
  const response = await fetch(quotaUrl(userId));
  return parseJson(response, (data) => userQuotaResponseSchema.parse(data));
}

/** Sets or clears (null) a user's storage quota override. */
export async function updateUserQuota(
  userId: string,
  quotaMb: number | null,
): Promise<UserQuotaResponse> {
  const response = await fetch(quotaUrl(userId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quotaMb }),
  });
  return parseJson(response, (data) => userQuotaResponseSchema.parse(data));
}
