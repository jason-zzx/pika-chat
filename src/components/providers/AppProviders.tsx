"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { installClipboardPolyfill } from "@/lib/clipboard-polyfill";

// Streamdown's built-in copy buttons call `navigator.clipboard` directly;
// install the insecure-context fallback once, as early as the client entry
// module loads. SSR-safe: the install guards on `navigator`.
installClipboardPolyfill();

export default function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
