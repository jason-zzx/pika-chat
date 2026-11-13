"use client";

import { createContext, useContext } from "react";

/**
 * The signed-in account of the current document (chat task R5/§7).
 *
 * Server-rendered routes resolve the actor once and hand its id down; client
 * code uses it to scope account-owned state (generation query keys, pending
 * request receipts) so a document that outlives an account change cannot read
 * the previous account's cache. `null` means "no confirmed account" — the
 * anonymous pages and component tests.
 *
 * The context lives here (not in a component directory) so neither the chat
 * feature nor the app-level providers have to import across domain boundaries.
 */
export const AccountUserIdContext = createContext<string | null>(null);

export function useAccountUserId(): string | null {
  return useContext(AccountUserIdContext);
}
