"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api/client";
import { LiveProvider } from "@/lib/live/live-provider";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        // A 4xx will not get better by asking again. Anything else gets one retry.
        retry: (failures, error) =>
          failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        className: "font-sans",
        style: {
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1px solid var(--rule-strong)",
          borderRadius: "var(--r-control)",
          boxShadow: "none",
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // React warns about a <script> rendered on the client. The theme script
      // only has to run from the server HTML, so the client copy is inert.
      scriptProps={{
        type: typeof window === "undefined" ? "text/javascript" : "text/plain",
        suppressHydrationWarning: true,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <LiveProvider>{children}</LiveProvider>
        </NuqsAdapter>
      </QueryClientProvider>
      <ThemedToaster />
    </ThemeProvider>
  );
}
