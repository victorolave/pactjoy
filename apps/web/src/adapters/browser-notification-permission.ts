import type {
  NotificationPermissionPort,
  NotificationPermissionState,
} from "../ports/notification-permission.ts";

/** The slice of the browser's `Notification` this adapter uses. */
export interface NotificationApi {
  readonly permission: NotificationPermissionState | "unsupported";
  /**
   * Old Safari only knows the callback form and returns `undefined`; current browsers return a
   * promise (and may also call the callback).
   */
  requestPermission(
    callback?: (permission: NotificationPermissionState) => void,
  ): Promise<NotificationPermissionState> | undefined;
}

/**
 * Reads and requests the notification permission from the browser's `Notification`. iOS has it
 * only in an installed app (16.4+) and answers `requestPermission` only from a user gesture.
 */
export class BrowserNotificationPermission implements NotificationPermissionPort {
  readonly #api: NotificationApi | undefined;

  constructor(
    api: NotificationApi | undefined = typeof Notification === "undefined"
      ? undefined
      : Notification,
  ) {
    this.#api = api;
  }

  state(): NotificationPermissionState {
    return this.#api === undefined
      ? "unsupported"
      : (this.#api.permission as NotificationPermissionState);
  }

  request(): Promise<NotificationPermissionState> {
    const api = this.#api;
    if (api === undefined) return Promise.resolve("unsupported");
    // The call is synchronous (no `await` before it): it has to start inside the tap's own call
    // stack. The promise settles with whichever form answers first, callback or returned promise.
    return new Promise((resolve) => {
      try {
        const returned = api.requestPermission((permission) => resolve(permission));
        if (returned !== undefined && typeof returned.then === "function") {
          returned.then(resolve, () => resolve(this.state()));
        }
      } catch {
        resolve(this.state());
      }
    });
  }
}
