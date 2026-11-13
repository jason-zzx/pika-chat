"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { installClipboardPolyfill } from "@/lib/clipboard-polyfill";

import AccountProvider from "./AccountProvider";
import ChatPoolBridge from "./ChatPoolBridge";

// Streamdown's built-in copy buttons call `navigator.clipboard` directly;
// install the insecure-context fallback once, as early as the client entry
// module loads. SSR-safe: the install guards on `navigator`.
installClipboardPolyfill();

export default function AppProviders({
  userId,
  children,
}: {
  /** Account the server resolved for this request; null on anonymous pages. */
  userId: string | null;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider userId={userId}>
        <TooltipProvider>
          <ChatPoolBridge />
          {children}
        </TooltipProvider>
      </AccountProvider>
    </QueryClientProvider>
  );
}
