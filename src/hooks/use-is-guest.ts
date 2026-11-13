"use client";

import { createContext, useContext } from "react";

/**
 * Whether the current signed-in session belongs to an anonymous demo guest.
 * Provided by `AppShell` from the server-resolved `actor.isGuest` so client
 * components across domains (chat, sidebar, settings) can adapt without
 * cross-domain imports or extra session fetches.
 */
export const IsGuestContext = createContext(false);

export function useIsGuest(): boolean {
  return useContext(IsGuestContext);
}
