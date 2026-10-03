import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback } from "react";
import { SessionProvider } from "../features/auth/session-context.tsx";
import { ApiProvider } from "./api-context.tsx";
import type { AppDependencies } from "./dependencies.ts";

export function AppProviders({
  deps,
  children,
}: {
  readonly deps: AppDependencies;
  readonly children: ReactNode;
}) {
  const { queryClient } = deps;
  // Cached data belongs to the signed-in user: drop it whenever the session ends.
  const onSessionEnd = useCallback(() => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider
        auth={deps.auth}
        store={deps.store}
        manager={deps.sessions}
        expired={deps.sessionEvents}
        onSessionEnd={onSessionEnd}
      >
        <ApiProvider api={deps.api}>{children}</ApiProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
