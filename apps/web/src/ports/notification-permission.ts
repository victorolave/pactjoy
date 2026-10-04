/**
 * The browser's permission to show notifications. Only the permission: nothing is subscribed and
 * nothing is sent from here (push arrives with the scheduled jobs, change D).
 */
export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export interface NotificationPermissionPort {
  /** The current permission, `unsupported` where the browser has no Notification API. */
  state(): NotificationPermissionState;
  /**
   * Asks the user. It must run synchronously inside a tap handler (iOS refuses it otherwise), so a
   * caller must not `await` anything before it. Never rejects: failures answer the current state.
   */
  request(): Promise<NotificationPermissionState>;
}
