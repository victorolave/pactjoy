/**
 * This device's Web Push subscription (ADR-0017). The browser holds it; the server only learns the
 * endpoint and keys through the API. Nothing here asks for permission: that stays with
 * `NotificationPermissionPort`, from a tap.
 */

/** What `PushSubscription.toJSON()` gives, minus `expirationTime`. */
export interface DevicePushSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface CurrentPushSubscription {
  readonly subscription: DevicePushSubscription;
  /** The VAPID key it was made with (base64url), to resubscribe after a rotation; null if unknown. */
  readonly serverKey: string | null;
}

export interface PushSubscriptionPort {
  /** Whether this browser can subscribe at all (a service worker and the Push API). */
  supported(): boolean;
  /** This device's subscription, or null. Never rejects: a failure reads as null. */
  current(): Promise<CurrentPushSubscription | null>;
  /** Subscribes with the server's public key. Rejects when the browser refuses. */
  subscribe(vapidPublicKey: string): Promise<DevicePushSubscription>;
  /** Drops this device's subscription; the endpoint it had, or null when there was none. */
  unsubscribe(): Promise<string | null>;
}
