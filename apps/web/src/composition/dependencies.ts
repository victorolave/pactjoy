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
import type { ImageProcessor } from "../ports/image-processor.ts";
import type { NotificationPermissionPort } from "../ports/notification-permission.ts";
import type { OutboxStore } from "../ports/outbox-store.ts";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import type { PhotoUploader } from "../ports/photo-uploader.ts";
import type { PushSubscriptionPort } from "../ports/push-subscription.ts";
import type { ReminderNamesPort } from "../ports/reminder-names.ts";
import type { Sharing } from "../ports/sharing.ts";
import type { TokenStore } from "../ports/token-store.ts";
import type { Visibility } from "../ports/visibility.ts";

/** Everything the composition root wires: ports implemented by adapters (or by fakes in tests). */
export interface AppDependencies {
  readonly auth: AuthPort;
  /** Device time, for comparing server instants (an invite's `expiresAt`). */
  readonly clock: Clock;
  readonly api: PactJoyApi;
  readonly ids: IdSource;
  /** Resizes and re-encodes a picked photo as a metadata-free JPEG (ADR-0016). */
  readonly imageProcessor: ImageProcessor;
  /** PUTs the prepared bytes to the signed storage URL; never sends API credentials. */
  readonly photoUploader: PhotoUploader;
  readonly haptics: Haptics;
  readonly connectivity: Connectivity;
  readonly store: TokenStore;
  /** Device flags and the name draft; only the draft is cleared when the session ends. */
  readonly device: DeviceStore;
  readonly sharing: Sharing;
  /** Whether the app runs from the home screen; the welcome gate skips the carousel there. */
  readonly appInstall: AppInstall;
  /** The notification permission; the permission step and Ajustes ask it from a tap. */
  readonly notifications: NotificationPermissionPort;
  /** This device's Web Push subscription (ADR-0017); subscribed only after a granted permission. */
  readonly push: PushSubscriptionPort;
  /** The own visible habit names reminder pushes may show (D2); forgotten when the session ends. */
  readonly reminderNames: ReminderNamesPort;
  /** Entry writes made without a connection, per user; erased when the session ends (OE-R6). */
  readonly outboxStore: OutboxStore;
  /** Whether the app is on screen; coming back to it retries what the outbox could not send. */
  readonly visibility: Visibility;
  readonly sessions: SessionManager;
  /** The API adapter's `onUnauthorized` calls `sessionEvents.expire`. */
  readonly sessionEvents: SessionEvents;
  readonly queryClient: QueryClient;
  /** Keeps the last Today for offline reads. */
  readonly persister: Persister;
}
