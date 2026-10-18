import type { NotificationPermissionPort } from "../../ports/notification-permission.ts";
import type { PactJoyApi } from "../../ports/pactjoy-api.ts";
import type { PushSubscriptionPort } from "../../ports/push-subscription.ts";

/**
 * This device's Web Push lifecycle (ADR-0017). The permission is asked only from a tap; this module
 * then subscribes with the server's public key and registers the device, keeps it in sync on every
 * start, and removes it on sign-out or once the permission is revoked. Everything after the tap is
 * best effort: the app works the same without push.
 */
export interface PushDeviceDeps {
  readonly permission: NotificationPermissionPort;
  readonly push: PushSubscriptionPort;
  readonly api: Pick<
    PactJoyApi,
    "getPushConfig" | "savePushSubscription" | "removePushSubscription"
  >;
}

/** Where push stands on this device after a step. */
export type PushStep = "active" | "off" | "blocked" | "unavailable";

/**
 * From the Activar tap: the permission request starts synchronously, inside the gesture (iOS needs
 * it), before anything is awaited; on a grant the device is subscribed and registered.
 */
export function enablePush(deps: PushDeviceDeps): Promise<PushStep> {
  const asked = deps.permission.request();
  return asked.then((state): Promise<PushStep> | PushStep => {
    if (state === "granted") return syncPush(deps);
    if (state === "denied") return "blocked";
    if (state === "unsupported") return "unavailable";
    return "off";
  });
}

/** One sync at a time per device: the start-up sync and Ajustes share the run in flight. */
const inFlight = new WeakMap<PushSubscriptionPort, Promise<PushStep>>();

/**
 * Makes the server know this device: reuses its subscription (or resubscribes when the server's key
 * changed, a rotation) and registers it again, which is idempotent by endpoint. Assumes the
 * permission is granted. Rejects when the browser refuses to subscribe or the API fails. Calls made
 * while one runs get that same run.
 */
export function syncPush(deps: PushDeviceDeps): Promise<PushStep> {
  const running = inFlight.get(deps.push);
  if (running !== undefined) return running;
  const run = syncOnce(deps).finally(() => inFlight.delete(deps.push));
  inFlight.set(deps.push, run);
  return run;
}

/** Settles once the sync in flight for this device (if any) is over; never starts one, never rejects. */
export function syncSettled(push: PushSubscriptionPort): Promise<void> {
  const running = inFlight.get(push);
  return running === undefined
    ? Promise.resolve()
    : running.then(
        () => undefined,
        () => undefined,
      );
}

async function syncOnce(deps: PushDeviceDeps): Promise<PushStep> {
  if (!deps.push.supported()) return "unavailable";
  const { vapidPublicKey } = await deps.api.getPushConfig();
  if (vapidPublicKey === null) return "unavailable";
  const current = await deps.push.current();
  let device = current?.subscription ?? null;
  if (current !== null && current.serverKey !== null && current.serverKey !== vapidPublicKey) {
    await deps.push.unsubscribe();
    device = null;
  }
  device ??= await deps.push.subscribe(vapidPublicKey);
  await deps.api.savePushSubscription(device);
  return "active";
}

/**
 * Removes this device here and on the server (sign-out, REQ-X7; revoked permission, REQ-X6). The
 * server goes first, while the session can still call it. Never rejects: a stale endpoint left on
 * the server is removed by its first 404/410.
 */
export async function removeThisDevice(deps: PushDeviceDeps): Promise<void> {
  if (!deps.push.supported()) return;
  const current = await deps.push.current();
  if (current === null) return;
  try {
    await deps.api.removePushSubscription(current.subscription.endpoint);
  } catch {
    // Best effort: see above.
  }
  try {
    await deps.push.unsubscribe();
  } catch {
    // Best effort: the browser drops a subscription whose permission is gone anyway.
  }
}

/**
 * After the account was deleted (ADR-0019): the server already erased this device's registration
 * with the user, so only the browser's subscription is left. Never calls the API, never rejects.
 */
export async function dropThisDeviceLocally(push: PushSubscriptionPort): Promise<void> {
  if (!push.supported()) return;
  try {
    await push.unsubscribe();
  } catch {
    // Best effort: the browser drops a subscription whose permission is gone anyway.
  }
}

/** On every app start with a session (REQ-X5, REQ-X6). Never rejects. */
export async function resyncOnStart(deps: PushDeviceDeps): Promise<void> {
  try {
    if (!deps.push.supported()) return;
    const state = deps.permission.state();
    if (state === "granted") await syncPush(deps);
    else if (state === "denied") await removeThisDevice(deps);
  } catch {
    // The app works the same without push; the next start tries again.
  }
}

/** What the Ajustes row shows (REQ-N1..N3). */
export type PushStatus = "active" | "off" | "blocked" | "notInstalled" | "unavailable";

export async function pushStatus(
  deps: PushDeviceDeps & { readonly installed: boolean },
): Promise<PushStatus> {
  const permission = deps.permission.state();
  if (!deps.push.supported() || permission === "unsupported") {
    return deps.installed ? "unavailable" : "notInstalled";
  }
  if (permission === "denied") return "blocked";
  const { vapidPublicKey } = await deps.api.getPushConfig();
  if (vapidPublicKey === null) return "unavailable";
  if (permission === "granted" && (await deps.push.current()) !== null) return "active";
  return "off";
}
