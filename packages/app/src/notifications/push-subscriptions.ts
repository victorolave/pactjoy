import type { IdGenerator } from "../ports/id-generator.ts";
import type { PushSender } from "../ports/push-sender.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { pushSubscriptionId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { MAX_SUBSCRIPTIONS_PER_USER } from "./push-subscription.repository.ts";

export interface PushSubscriptionDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** `null` when Web Push is not configured on this server. */
  readonly push: PushSender | null;
}

/** What the browser's `PushSubscription.toJSON()` gives, minus `expirationTime` (ignored). */
export interface SavePushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface RemovePushSubscriptionInput {
  readonly endpoint: string;
}

export type PushSubscriptionError =
  | { readonly kind: "InvalidPushSubscription" }
  | { readonly kind: "PushNotConfigured" };

const MAX_ENDPOINT_LENGTH = 1024;
/** An uncompressed P-256 point (65 bytes starting 0x04) in base64url: 87 characters, the first `B`. */
const P256DH = /^B[A-Za-z0-9_-]{86}$/;
/** A 16-byte secret in base64url: 22 characters. */
const AUTH = /^[A-Za-z0-9_-]{22}$/;

const INVALID = err({ kind: "InvalidPushSubscription" } as const);
const unpadded = (value: unknown) => (typeof value === "string" ? value.replace(/=+$/, "") : null);

function validEndpoint(endpoint: unknown): endpoint is string {
  return (
    typeof endpoint === "string" &&
    endpoint.length <= MAX_ENDPOINT_LENGTH &&
    endpoint.startsWith("https://")
  );
}

/**
 * Registers the device the caller is on (REQ-X1): idempotent by endpoint, and an endpoint already
 * stored for someone else moves to the caller (one endpoint, one user). The endpoint must be one
 * the push sender accepts (https on a known push service: the SSRF guard, design J11) and the keys
 * must have the shape the encryption needs; anything else is `InvalidPushSubscription` and nothing
 * is stored. A user keeps at most ten devices, the least recently seen going first.
 */
export async function savePushSubscription(
  deps: PushSubscriptionDeps,
  actor: Actor,
  input: SavePushSubscriptionInput,
): Promise<Result<void, PushSubscriptionError>> {
  if (deps.push === null) return err({ kind: "PushNotConfigured" });
  const endpoint: unknown = input?.endpoint;
  const p256dh = unpadded(input?.keys?.p256dh);
  const auth = unpadded(input?.keys?.auth);
  if (!validEndpoint(endpoint) || !deps.push.accepts(endpoint)) return INVALID;
  if (p256dh === null || !P256DH.test(p256dh) || auth === null || !AUTH.test(auth)) return INVALID;

  const now = deps.clock.now();
  const id = pushSubscriptionId(deps.ids.next());
  return deps.uow.transaction(async (repos) => {
    await repos.pushSubscriptions.upsert({
      id,
      userId: actor.userId,
      endpoint,
      p256dh,
      auth,
      createdAt: now,
      lastSeenAt: now,
    });
    await repos.pushSubscriptions.trimOldest(actor.userId, MAX_SUBSCRIPTIONS_PER_USER);
    return ok(undefined);
  });
}

/** Removes the caller's own device (REQ-X2, logout): idempotent; nobody else's is ever touched. */
export async function removePushSubscription(
  deps: Pick<PushSubscriptionDeps, "uow">,
  actor: Actor,
  input: RemovePushSubscriptionInput,
): Promise<Result<void, PushSubscriptionError>> {
  const endpoint: unknown = input?.endpoint;
  if (!validEndpoint(endpoint)) return INVALID;
  return deps.uow.transaction(async (repos) => {
    await repos.pushSubscriptions.remove(actor.userId, endpoint);
    return ok(undefined);
  });
}

export interface PushConfig {
  /** The public VAPID key the browser subscribes with; `null` when Web Push is not configured. */
  readonly vapidPublicKey: string | null;
}

/** The one source of the public VAPID key (design J10): a rotation needs no web rebuild. */
export function pushConfig(deps: Pick<PushSubscriptionDeps, "push">): PushConfig {
  return { vapidPublicKey: deps.push?.applicationServerKey ?? null };
}
