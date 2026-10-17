import type { Instant, PushMessage, PushOutcome, PushSender, PushTarget } from "@pactjoy/app";
import { encryptPayload } from "./aes128gcm.ts";
import { fromBase64Url, toBase64Url } from "./base64url.ts";
import { importVapidKeys, type VapidKeys, vapidAuthorization } from "./vapid.ts";

/** The slice of `fetch` the sender needs, so tests and runtimes can inject their own. */
export type WebPushFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export interface WebPushSenderOptions {
  /** `API_PUSH_VAPID_PUBLIC_KEY`: base64url uncompressed P-256 point. */
  readonly publicKey: string;
  /** `API_PUSH_VAPID_PRIVATE_KEY`: base64url scalar `d`. */
  readonly privateKey: string;
  /** `API_PUSH_VAPID_SUBJECT`: `mailto:` or `https:` contact. */
  readonly subject: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: WebPushFetch;
}

/**
 * The push services the server may POST to (SSRF guard, ADR-0017): Apple, Google (FCM), Mozilla
 * and Microsoft (WNS). `exact` hosts must match fully; `suffix` hosts must end with the suffix
 * after at least one more label. The list lives here, in the adapter, never in the app.
 */
const EXACT_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    EXACT_HOSTS.has(host) ||
    HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}

/** A header-safe Topic (at most 32 base64url characters, RFC 8030 section 5.4) from any collapse key. */
async function topicFor(collapseKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(collapseKey));
  return toBase64Url(new Uint8Array(digest)).slice(0, 32);
}

function retryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

function outcomeOf(status: number, headers: { get(name: string): string | null }): PushOutcome {
  if (status >= 200 && status < 300) return { kind: "delivered" };
  if (status === 404 || status === 410) return { kind: "gone" };
  if (status === 429 || status >= 500) {
    return { kind: "retry", retryAfterSeconds: retryAfter(headers.get("retry-after")) };
  }
  return { kind: "rejected", status };
}

/**
 * The {@link PushSender} over the Web Push protocol (RFC 8030) with VAPID (RFC 8292) and aes128gcm
 * (RFC 8291). The VAPID keys are imported once, on the first send. An HTTP or network failure is
 * an outcome, never a throw; an endpoint outside the allowlist, or a device key that is not a
 * P-256 point, is `rejected` with status 0 and nothing is sent.
 */
export function createWebPushSender(options: WebPushSenderOptions): PushSender {
  const send: WebPushFetch =
    options.fetch ??
    (async (url, init) => {
      const response = await fetch(url, { ...init, body: init.body as BodyInit });
      return { status: response.status, headers: response.headers };
    });
  let keys: Promise<VapidKeys> | null = null;
  const vapidKeys = () => {
    keys ??= importVapidKeys(options.publicKey, options.privateKey);
    return keys;
  };

  return {
    applicationServerKey: options.publicKey,

    accepts: isAllowedPushEndpoint,

    async send(target: PushTarget, message: PushMessage, now: Instant): Promise<PushOutcome> {
      if (!isAllowedPushEndpoint(target.endpoint)) return { kind: "rejected", status: 0 };
      let body: Uint8Array;
      try {
        body = await encryptPayload({
          uaPublic: fromBase64Url(target.p256dh),
          authSecret: fromBase64Url(target.auth),
          plaintext: message.payload,
        });
      } catch {
        return { kind: "rejected", status: 0 };
      }
      const authorization = await vapidAuthorization({
        audience: new URL(target.endpoint).origin,
        subject: options.subject,
        keys: await vapidKeys(),
        now,
      });
      try {
        const response = await send(target.endpoint, {
          method: "POST",
          headers: {
            TTL: String(message.ttlSeconds),
            Urgency: message.urgency,
            Topic: await topicFor(message.collapseKey),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            Authorization: authorization,
          },
          body,
        });
        return outcomeOf(response.status, response.headers);
      } catch {
        return { kind: "retry", retryAfterSeconds: null };
      }
    },
  };
}
