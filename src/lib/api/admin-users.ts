import { parseEmpty } from "@/lib/api/parse";

/** Permanently deletes a user and all of their data. */
export async function deleteAdminUser(userId: string): Promise<void> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  return parseEmpty(response);
}
