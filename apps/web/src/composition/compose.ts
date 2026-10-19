import { BrowserAppInstall } from "../adapters/browser-app-install.ts";
import { BrowserConnectivity } from "../adapters/browser-connectivity.ts";
import { BrowserHaptics } from "../adapters/browser-haptics.ts";
import { BrowserNotificationPermission } from "../adapters/browser-notification-permission.ts";
import { BrowserPushSubscription } from "../adapters/browser-push-subscription.ts";
import { BrowserSharing } from "../adapters/browser-sharing.ts";
import { BrowserVisibility } from "../adapters/browser-visibility.ts";
import { CacheReminderNames } from "../adapters/cache-reminder-names.ts";
import { CanvasImageProcessor } from "../adapters/canvas-image-processor.ts";
import { CryptoIds } from "../adapters/crypto-ids.ts";
import { FetchPhotoUploader } from "../adapters/fetch-photo-uploader.ts";
import { GoTrueAuth, type GoTrueAuthOptions } from "../adapters/gotrue-auth.ts";
import { HttpPactJoyApi } from "../adapters/http-pactjoy-api.ts";
import { LocalStorageDeviceStore } from "../adapters/local-storage-device-store.ts";
import { LocalStorageOutboxStore } from "../adapters/local-storage-outbox-store.ts";
import { LocalStorageTokenStore } from "../adapters/local-storage-token-store.ts";
import { createTodayPersister } from "../adapters/query-persister.ts";
import { SystemClock } from "../adapters/system-clock.ts";
import { WebLocks } from "../adapters/web-locks.ts";
import type { AppConfig } from "../config.ts";
import { createSessionEvents, SessionManager } from "../features/auth/index.ts";
import type { TokenStore } from "../ports/token-store.ts";
import type { AppDependencies } from "./dependencies.ts";
import { createQueryClient } from "./query-client.ts";

export interface ComposeEnvironment {
  /** The browser's fetch, handed in by main.tsx (the only place allowed to name it). */
  readonly fetch: GoTrueAuthOptions["fetch"];
  /** Defaults to the localStorage adapter. */
  readonly store?: TokenStore | undefined;
}

/** Builds the adapters and the objects that wire them together. */
export function createDependencies(config: AppConfig, env: ComposeEnvironment): AppDependencies {
  const clock = new SystemClock();
  const auth = new GoTrueAuth({
    baseUrl: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    fetch: env.fetch,
    clock,
  });
  const store = env.store ?? new LocalStorageTokenStore();
  const sessions = new SessionManager(auth, store, clock);
  const sessionEvents = createSessionEvents();
  return {
    auth,
    clock,
    api: new HttpPactJoyApi({
      baseUrl: config.apiBaseUrl,
      getAccessToken: () => sessions.getAccessToken(),
      refreshAccessToken: () => sessions.forceRefresh(),
      onUnauthorized: () => sessionEvents.expire(),
      fetch: env.fetch,
    }),
    ids: new CryptoIds(),
    imageProcessor: new CanvasImageProcessor(),
    photoUploader: new FetchPhotoUploader(env.fetch),
    haptics: new BrowserHaptics(),
    connectivity: new BrowserConnectivity(),
    store,
    device: new LocalStorageDeviceStore(),
    sharing: new BrowserSharing(),
    appInstall: new BrowserAppInstall(),
    notifications: new BrowserNotificationPermission(),
    push: new BrowserPushSubscription(),
    reminderNames: new CacheReminderNames(),
    outboxStore: new LocalStorageOutboxStore(),
    visibility: new BrowserVisibility(),
    locks: new WebLocks(),
    sessions,
    sessionEvents,
    queryClient: createQueryClient(),
    persister: createTodayPersister(),
  };
}
