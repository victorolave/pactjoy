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
import { NotificationPermissionProvider } from "../context/notification-permission-context.tsx";
import { PhotoProvider } from "../context/photo-context.tsx";
import { PushSubscriptionProvider } from "../context/push-subscription-context.tsx";
import { ReminderNamesProvider } from "../context/reminder-names-context.tsx";
import { SharingProvider } from "../context/sharing-context.tsx";
import { ToastProvider } from "../context/toast-context.tsx";
import { SessionProvider, useSession } from "../features/auth/index.ts";
import {
  dropThisDeviceLocally,
  PushSync,
  removeThisDevice,
} from "../features/notifications/index.ts";
import type { AppDependencies } from "./dependencies.ts";

export function AppProviders({
  deps,
  children,
}: {
  readonly deps: AppDependencies;
  readonly children: ReactNode;
}) {
  const { queryClient, persister, device, reminderNames } = deps;
  // Cached data belongs to the signed-in user: drop it, and the saved copy, whenever the session
  // ends. So do the name draft and the habit names reminders show. The device flags (welcome seen,
  // install and permission steps) are about this phone, not the person, so they stay: the carousel
  // does not return on every login.
  const onSessionEnd = useCallback(() => {
    queryClient.clear();
    void persister.removeClient();
    device.clearSession();
    void reminderNames.clear();
  }, [queryClient, persister, device, reminderNames]);
  // The device's push registration belongs to the person: removed before the session ends.
  const { notifications, push, api } = deps;
  const beforeSignOut = useCallback(
    () => removeThisDevice({ permission: notifications, push, api }),
    [notifications, push, api],
  );
  // After a deletion only the browser's own subscription is left to drop (the server erased the rest).
  const onAccountDeleted = useCallback(() => dropThisDeviceLocally(push), [push]);
  return (
    <SessionProvider
      auth={deps.auth}
      store={deps.store}
      manager={deps.sessions}
      expired={deps.sessionEvents}
      onSessionEnd={onSessionEnd}
      beforeSignOut={beforeSignOut}
      onAccountDeleted={onAccountDeleted}
    >
      <PersistedQueries client={queryClient} persister={persister}>
        <ApiProvider api={deps.api}>
          <IdsProvider ids={deps.ids}>
            <PhotoProvider
              tools={{ imageProcessor: deps.imageProcessor, photoUploader: deps.photoUploader }}
            >
              <HapticsProvider haptics={deps.haptics}>
                <ConnectivityProvider connectivity={deps.connectivity}>
                  <DeviceStoreProvider device={deps.device}>
                    <SharingProvider sharing={deps.sharing}>
                      <AppInstallProvider appInstall={deps.appInstall}>
                        <NotificationPermissionProvider notifications={deps.notifications}>
                          <PushSubscriptionProvider push={deps.push}>
                            <ReminderNamesProvider reminderNames={reminderNames}>
                              <ClockProvider clock={deps.clock}>
                                <SessionPushSync />
                                <ToastProvider>{children}</ToastProvider>
                              </ClockProvider>
                            </ReminderNamesProvider>
                          </PushSubscriptionProvider>
                        </NotificationPermissionProvider>
                      </AppInstallProvider>
                    </SharingProvider>
                  </DeviceStoreProvider>
                </ConnectivityProvider>
              </HapticsProvider>
            </PhotoProvider>
          </IdsProvider>
        </ApiProvider>
      </PersistedQueries>
    </SessionProvider>
  );
}

/** Re-syncs this device's push registration for the signed-in user (ADR-0017). */
function SessionPushSync() {
  return <PushSync userId={useSession().session?.userId ?? null} />;
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
