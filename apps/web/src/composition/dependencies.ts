import type { QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import type { SessionEvents, SessionManager } from "../features/auth/index.ts";
import type { AppInstall } from "../ports/app-install.ts";
import type { AuthPort } from "../ports/auth.ts";
import type { Clock } from "../ports/clock.ts";
import type { Connectivity } from "../ports/connectivity.ts";
import type { DeviceStore } from "../ports/device-store.ts";
import type { Haptics } from "../ports/haptics.ts";
import type { IdSource } from "../ports/ids.ts";
import type { NotificationPermissionPort } from "../ports/notification-permission.ts";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import type { Sharing } from "../ports/sharing.ts";
import type { TokenStore } from "../ports/token-store.ts";

/** Everything the composition root wires: ports implemented by adapters (or by fakes in tests). */
export interface AppDependencies {
  readonly auth: AuthPort;
  /** Device time, for comparing server instants (an invite's `expiresAt`). */
  readonly clock: Clock;
  readonly api: PactJoyApi;
  readonly ids: IdSource;
  readonly haptics: Haptics;
  readonly connectivity: Connectivity;
  readonly store: TokenStore;
  /** Device flags and the name draft; only the draft is cleared when the session ends. */
  readonly device: DeviceStore;
  readonly sharing: Sharing;
  /** Whether the app runs from the home screen; the welcome gate skips the carousel there. */
  readonly appInstall: AppInstall;
  /** The notification permission; the permission step asks it from a tap (nothing is sent yet). */
  readonly notifications: NotificationPermissionPort;
  readonly sessions: SessionManager;
  /** The API adapter's `onUnauthorized` calls `sessionEvents.expire`. */
  readonly sessionEvents: SessionEvents;
  readonly queryClient: QueryClient;
  /** Keeps the last Today for offline reads. */
  readonly persister: Persister;
}
