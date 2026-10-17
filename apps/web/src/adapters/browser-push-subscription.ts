import type {
  CurrentPushSubscription,
  DevicePushSubscription,
  PushSubscriptionPort,
} from "../ports/push-subscription.ts";

/** The slices of the Push API the adapter uses, so tests can hand in their own. */
export interface PushSubscriptionLike {
  readonly endpoint: string;
  readonly options?: { readonly applicationServerKey: ArrayBuffer | null };
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array;
  }): Promise<PushSubscriptionLike>;
}

export interface ServiceWorkerContainerLike {
  readonly ready: Promise<{ readonly pushManager: PushManagerLike }>;
}

function defaultContainer(): ServiceWorkerContainerLike | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  if (typeof window === "undefined" || !("PushManager" in window)) return undefined;
  return navigator.serviceWorker as unknown as ServiceWorkerContainerLike;
}

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

function deviceOf(subscription: PushSubscriptionLike): DevicePushSubscription {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") {
    throw new Error("push subscription without keys");
  }
  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
}

/**
 * {@link PushSubscriptionPort} over `navigator.serviceWorker.ready.pushManager` (ADR-0017). Always
 * `userVisibleOnly` (the only mode iOS allows, and every push shows a notification).
 */
export class BrowserPushSubscription implements PushSubscriptionPort {
  readonly #container: ServiceWorkerContainerLike | undefined;
  readonly #readyTimeoutMs: number;

  /**
   * `readyTimeoutMs` bounds the wait for an active worker: `serviceWorker.ready` never settles when
   * none is active (dev, a failed registration), and nothing here may hang the app (sign-out).
   */
  constructor(
    container: ServiceWorkerContainerLike | undefined = defaultContainer(),
    readyTimeoutMs = 3_000,
  ) {
    this.#container = container;
    this.#readyTimeoutMs = readyTimeoutMs;
  }

  supported(): boolean {
    return this.#container !== undefined;
  }

  async current(): Promise<CurrentPushSubscription | null> {
    try {
      const subscription = await (await this.#manager()).getSubscription();
      if (subscription === null) return null;
      const key = subscription.options?.applicationServerKey ?? null;
      return {
        subscription: deviceOf(subscription),
        serverKey: key === null ? null : toBase64Url(new Uint8Array(key)),
      };
    } catch {
      return null;
    }
  }

  async subscribe(vapidPublicKey: string): Promise<DevicePushSubscription> {
    const subscription = await (await this.#manager()).subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(vapidPublicKey),
    });
    return deviceOf(subscription);
  }

  async unsubscribe(): Promise<string | null> {
    const subscription = await (await this.#manager()).getSubscription();
    if (subscription === null) return null;
    await subscription.unsubscribe();
    return subscription.endpoint;
  }

  async #manager(): Promise<PushManagerLike> {
    if (this.#container === undefined) throw new Error("push is not supported");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("no active service worker")), this.#readyTimeoutMs);
    });
    try {
      return (await Promise.race([this.#container.ready, timeout])).pushManager;
    } finally {
      clearTimeout(timer);
    }
  }
}
