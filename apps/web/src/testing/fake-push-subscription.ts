import type {
  CurrentPushSubscription,
  DevicePushSubscription,
  PushSubscriptionPort,
} from "../ports/push-subscription.ts";

const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };

/** Scriptable device subscription: supported and empty unless told otherwise. */
export class FakePushSubscription implements PushSubscriptionPort {
  isSupported = true;
  device: CurrentPushSubscription | null = null;
  /** When set, `subscribe` rejects with it (the browser refused). */
  refuse: Error | null = null;
  subscribes: string[] = [];
  unsubscribes = 0;
  #next = 1;

  supported(): boolean {
    return this.isSupported;
  }

  async current(): Promise<CurrentPushSubscription | null> {
    return this.device;
  }

  async subscribe(vapidPublicKey: string): Promise<DevicePushSubscription> {
    this.subscribes.push(vapidPublicKey);
    if (this.refuse !== null) throw this.refuse;
    const subscription = {
      endpoint: `https://web.push.apple.com/device-${this.#next++}`,
      keys: KEYS,
    };
    this.device = { subscription, serverKey: vapidPublicKey };
    return subscription;
  }

  async unsubscribe(): Promise<string | null> {
    this.unsubscribes += 1;
    const endpoint = this.device?.subscription.endpoint ?? null;
    this.device = null;
    return endpoint;
  }
}
