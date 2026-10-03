import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useCallback, useMemo } from "react";
import { persistOptionsFor } from "../adapters/query-persister.ts";
import { SessionProvider } from "../features/auth/session-context.tsx";
import { ApiProvider } from "./api-context.tsx";
import { ConnectivityProvider } from "./connectivity-context.tsx";
import type { AppDependencies } from "./dependencies.ts";
import { IdsProvider } from "./ids-context.tsx";
import { ToastProvider } from "./toast-context.tsx";

export function AppProviders({
  deps,
  children,
}: {
  readonly deps: AppDependencies;
  readonly children: ReactNode;
}) {
  const { queryClient, persister } = deps;
  // Cached data belongs to the signed-in user: drop it, and the saved copy, whenever the session ends.
  const onSessionEnd = useCallback(() => {
    queryClient.clear();
    void persister.removeClient();
  }, [queryClient, persister]);
  const persistOptions = useMemo(() => persistOptionsFor(persister), [persister]);
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SessionProvider
        auth={deps.auth}
        store={deps.store}
        manager={deps.sessions}
        expired={deps.sessionEvents}
        onSessionEnd={onSessionEnd}
      >
        <ApiProvider api={deps.api}>
          <IdsProvider ids={deps.ids}>
            <ConnectivityProvider connectivity={deps.connectivity}>
              <ToastProvider>{children}</ToastProvider>
            </ConnectivityProvider>
          </IdsProvider>
        </ApiProvider>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
