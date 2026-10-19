import type { QueryClient } from "@tanstack/react-query";
import { type Persister, PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
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
import { type SessionEndReason, SessionProvider, useSession } from "../features/auth/index.ts";
import { type Outbox, OutboxProvider, useOutbox } from "../features/entry/index.ts";
import {
  dropThisDeviceLocally,
  PushSync,
  removeThisDevice,
} from "../features/notifications/index.ts";
import { progressKey, socialKey, todayKey } from "../shared/query-keys.ts";
import type { AppDependencies } from "./dependencies.ts";

export function AppProviders({
  deps,
  children,
}: {
  readonly deps: AppDependencies;
  readonly children: ReactNode;
}) {
  const { queryClient, persister, device, reminderNames, outboxStore } = deps;
  // Cached data belongs to the signed-in user: drop it, and the saved copy, whenever the session
  // ends. So do the name draft and the habit names reminders show. The device flags (welcome seen,
  // install and permission steps) are about this phone, not the person, so they stay: the carousel
  // does not return on every login.
  // The entries queued without a connection are erased only when the member signs out or the
  // account is deleted. A session that expired on its own keeps them for the same user's next
  // sign-in (W4, owner decision 2026-10-18); a different user's sign-in erases them first.
  const onSessionEnd = useCallback(
    (reason: SessionEndReason) => {
      queryClient.clear();
      void persister.removeClient();
      device.clearSession();
      void reminderNames.clear();
      if (reason === "signedOut" || reason === "accountDeleted") outboxStore.clearAll();
    },
    [queryClient, persister, device, reminderNames, outboxStore],
  );
  const onSessionStart = useCallback(
    (userId: string) => outboxStore.clearExcept(userId),
    [outboxStore],
  );
  // The outbox lives below the SessionProvider (it needs the user id), yet the session's own hooks
  // must reach it: `SessionOutbox` registers it here.
  const outboxRef = useRef<Outbox | null>(null);
  // The device's push registration belongs to the person: removed before the session ends. The
  // entries still queued get one last replay in the same grace (OE-R6.S3).
  const { notifications, push, api, connectivity } = deps;
  const beforeSignOut = useCallback(
    async () =>
      void (await Promise.all([
        removeThisDevice({ permission: notifications, push, api }),
        // Without a connection there is nothing to send, and the grace is better spent signing out.
        connectivity.isOnline() ? outboxRef.current?.drain() : undefined,
      ])),
    [notifications, push, api, connectivity],
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
      onSessionStart={onSessionStart}
      beforeSignOut={beforeSignOut}
      onAccountDeleted={onAccountDeleted}
    >
      <SessionOutbox deps={deps} registry={outboxRef}>
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
      </SessionOutbox>
    </SessionProvider>
  );
}

/**
 * The entries queued without a connection belong to the signed-in user: one outbox per user id. After
 * a replay that changed anything the server's truth is read again (Today, the season progress reads
 * and the circle feed), as after any settled mutation.
 */
function SessionOutbox({
  deps,
  registry,
  children,
}: {
  readonly deps: AppDependencies;
  /** Where the current outbox is published for the session's own hooks (the sign-out replay). */
  readonly registry: MutableRefObject<Outbox | null>;
  readonly children: ReactNode;
}) {
  const { queryClient, api, outboxStore, ids, connectivity, visibility, locks, store } = deps;
  const userId = useSession().session?.userId ?? null;
  // The stored session, not React's: another tab can switch the user before this tree catches up.
  // When the store reads nothing (blocked or full storage keeps the session in memory only), the
  // live session's user stands, or the outbox would turn itself off for the whole session (S-C).
  const sessionUser = useRef(userId);
  sessionUser.current = userId;
  const currentUserId = useCallback(() => store.load()?.userId ?? sessionUser.current, [store]);
  const onReplayed = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: todayKey });
    void queryClient.invalidateQueries({ queryKey: progressKey });
    void queryClient.invalidateQueries({ queryKey: socialKey });
  }, [queryClient]);
  return (
    <OutboxProvider
      userId={userId}
      api={api}
      store={outboxStore}
      ids={ids}
      connectivity={connectivity}
      visibility={visibility}
      onReplayed={onReplayed}
      lock={locks}
      currentUserId={currentUserId}
    >
      <OutboxRegistrar registry={registry} />
      {children}
    </OutboxProvider>
  );
}

/** Publishes the current outbox, and withdraws it when it is replaced or the user leaves. */
function OutboxRegistrar({ registry }: { readonly registry: MutableRefObject<Outbox | null> }) {
  const outbox = useOutbox();
  useEffect(() => {
    registry.current = outbox;
    return () => {
      registry.current = null;
    };
  }, [outbox, registry]);
  return null;
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
