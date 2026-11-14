"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * Whether the current signed-in session belongs to an anonymous demo guest.
 * Provided by `AppShell` from the server-resolved `actor.isGuest` so client
 * components across domains (chat, sidebar, settings) can adapt without
 * cross-domain imports or extra session fetches.
 */
export const IsGuestContext = createContext(false);

// Server components (AppShell) cannot touch `IsGuestContext.Provider` across the
// client boundary, so they render this wrapper instead.
export function IsGuestProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <IsGuestContext.Provider value={value}>{children}</IsGuestContext.Provider>
  );
}

export function useIsGuest(): boolean {
  return useContext(IsGuestContext);
}
