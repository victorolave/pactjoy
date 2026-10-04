import type { QueryClient } from "@tanstack/react-query";
import { type Persister, PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useCallback, useMemo } from "react";
import { bustFor, persistOptionsFor } from "../adapters/query-persister.ts";
import { ApiProvider } from "../context/api-context.tsx";
import { AppInstallProvider } from "../context/app-install-context.tsx";
import { ClockProvider } from "../context/clock-context.tsx";
import { ConnectivityProvider } from "../context/connectivity-context.tsx";
import { DeviceStoreProvider } from "../context/device-store-context.tsx";
import { HapticsProvider } from "../context/haptics-context.tsx";
import { IdsProvider } from "../context/ids-context.tsx";
import { SharingProvider } from "../context/sharing-context.tsx";
import { ToastProvider } from "../context/toast-context.tsx";
import { SessionProvider, useSession } from "../features/auth/index.ts";
import type { AppDependencies } from "./dependencies.ts";

export function AppProviders({
  deps,
  children,
}: {
  readonly deps: AppDependencies;
  readonly children: ReactNode;
}) {
  const { queryClient, persister, device } = deps;
  // Cached data belongs to the signed-in user: drop it, and the saved copy, whenever the session
  // ends. So does the name draft. The device flags (welcome seen, install and permission steps)
  // are about this phone, not the person, so they stay: the carousel does not return on every login.
  const onSessionEnd = useCallback(() => {
    queryClient.clear();
    void persister.removeClient();
    device.clearSession();
  }, [queryClient, persister, device]);
  return (
    <SessionProvider
      auth={deps.auth}
      store={deps.store}
      manager={deps.sessions}
      expired={deps.sessionEvents}
      onSessionEnd={onSessionEnd}
    >
      <PersistedQueries client={queryClient} persister={persister}>
        <ApiProvider api={deps.api}>
          <IdsProvider ids={deps.ids}>
            <HapticsProvider haptics={deps.haptics}>
              <ConnectivityProvider connectivity={deps.connectivity}>
                <DeviceStoreProvider device={deps.device}>
                  <SharingProvider sharing={deps.sharing}>
                    <AppInstallProvider appInstall={deps.appInstall}>
                      <ClockProvider clock={deps.clock}>
                        <ToastProvider>{children}</ToastProvider>
                      </ClockProvider>
                    </AppInstallProvider>
                  </SharingProvider>
                </DeviceStoreProvider>
              </ConnectivityProvider>
            </HapticsProvider>
          </IdsProvider>
        </ApiProvider>
      </PersistedQueries>
    </SessionProvider>
  );
}

/** The saved Today is scoped to the signed-in user: another user's copy is never restored. */
function PersistedQueries({
  client,
  persister,
  children,
}: {
  readonly client: QueryClient;
  readonly persister: Persister;
  readonly children: ReactNode;
}) {
  const userId = useSession().session?.userId ?? null;
  const persistOptions = useMemo(
    () => persistOptionsFor(persister, bustFor(userId)),
    [persister, userId],
  );
  return (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
