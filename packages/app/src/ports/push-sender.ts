import type { Instant } from "../time/instant.ts";

/**
 * Web Push port (ADR-0017): encrypts a payload for one device and delivers it to its push
 * service. No vendor type, SDK, host list or HTTP detail appears here (CLAUDE.md, high
 * decoupling); `packages/push` is the adapter.
 */

/** One device, as its subscription stores it (base64url keys). */
export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushMessage {
  /** The JSON text the service worker receives; the adapter encodes it as UTF-8 and encrypts it. */
  readonly payload: string;
  /** How long the push service may hold it for an offline device. */
  readonly ttlSeconds: number;
  readonly urgency: "low" | "normal" | "high";
  /**
   * Notices with the same collapse key replace each other in the push service. Any string: the
   * adapter derives a header-safe token from it, so it never travels as given.
   */
  readonly collapseKey: string;
}

/**
 * - `delivered`: the push service accepted it (2xx).
 * - `gone`: the subscription no longer exists (404, 410): delete it.
 * - `retry`: worth trying again later (429, 5xx, network); `retryAfterSeconds` when the service said.
 * - `rejected`: refused for good (any other status).
 */
export type PushOutcome =
  | { readonly kind: "delivered" }
  | { readonly kind: "gone" }
  | { readonly kind: "retry"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "rejected"; readonly status: number };

export interface PushSender {
  /** The public VAPID key, base64url (the uncompressed P-256 point the browser subscribes with). */
  readonly applicationServerKey: string;
  /** Whether the server may POST to this endpoint: https on a known push service host, no port, no userinfo. */
  accepts(endpoint: string): boolean;
  /**
   * Sends one message to one device. An HTTP or network failure is an outcome, never a throw;
   * `now` (from the app Clock) dates the VAPID token.
   */
  send(target: PushTarget, message: PushMessage, now: Instant): Promise<PushOutcome>;
}
