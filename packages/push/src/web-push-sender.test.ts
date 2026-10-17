import { instant, type PushMessage, type PushTarget } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./base64url.ts";
import { createWebPushSender, type WebPushFetch } from "./web-push-sender.ts";

const NOW = instant(1_791_987_120_000);

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  return {
    publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d as string,
  };
}

async function device(endpoint = "https://web.push.apple.com/QGuQyavXut"): Promise<PushTarget> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    endpoint,
    p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const MESSAGE: PushMessage = {
  payload: new TextEncoder().encode('{"v":1,"kind":"seasonStarted","params":{"seasonId":"s"}}'),
  ttlSeconds: 3600,
  urgency: "normal",
  collapseKey: "seasonStarted:season-1:member-1",
};

interface Call {
  readonly url: string;
  readonly init: { method: string; headers: Record<string, string>; body: Uint8Array };
}

function recordingFetch(
  respond: () => Promise<{ status: number; headers?: Record<string, string> }>,
) {
  const calls: Call[] = [];
  const fetch: WebPushFetch = async (url, init) => {
    calls.push({ url, init });
    const { status, headers = {} } = await respond();
    return { status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } };
  };
  return { calls, fetch };
}

async function sender(respond: Parameters<typeof recordingFetch>[0]) {
  const keys = await vapidKeys();
  const recorder = recordingFetch(respond);
  return {
    keys,
    calls: recorder.calls,
    push: createWebPushSender({
      ...keys,
      subject: "mailto:ops@example.com",
      fetch: recorder.fetch,
    }),
  };
}

describe("createWebPushSender", () => {
  it("exposes the public VAPID key as the application server key", async () => {
    const { keys, push } = await sender(async () => ({ status: 201 }));
    expect(push.applicationServerKey).toBe(keys.publicKey);
  });

  it("POSTs one encrypted aes128gcm body with TTL, Urgency, Topic and a VAPID Authorization", async () => {
    const { calls, keys, push } = await sender(async () => ({ status: 201 }));
    const target = await device();
    expect(await push.send(target, MESSAGE, NOW)).toEqual({ kind: "delivered" });
    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.url).toBe(target.endpoint);
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      TTL: "3600",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    });
    expect(call.init.headers.Topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(call.init.headers.Authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`),
    );
    // salt (16) + rs (4) + idlen (1) + key id (65) + ciphertext (payload + delimiter + 16-byte tag)
    expect(call.init.body.length).toBe(86 + MESSAGE.payload.length + 1 + 16);
    // The plaintext never travels as such.
    expect(new TextDecoder().decode(call.init.body)).not.toContain("seasonStarted");
  });

  it("derives the Topic from the collapse key: stable, and never the key itself", async () => {
    const { calls, push } = await sender(async () => ({ status: 201 }));
    const target = await device();
    await push.send(target, MESSAGE, NOW);
    await push.send(target, MESSAGE, NOW);
    await push.send(target, { ...MESSAGE, collapseKey: "other" }, NOW);
    const topics = calls.map((c) => c.init.headers.Topic);
    expect(topics[0]).toBe(topics[1]);
    expect(topics[2]).not.toBe(topics[0]);
    expect(topics[0]).not.toContain("season");
  });

  it.each([
    [200, { kind: "delivered" }],
    [201, { kind: "delivered" }],
    [404, { kind: "gone" }],
    [410, { kind: "gone" }],
    [429, { kind: "retry", retryAfterSeconds: null }],
    [500, { kind: "retry", retryAfterSeconds: null }],
    [503, { kind: "retry", retryAfterSeconds: null }],
    [400, { kind: "rejected", status: 400 }],
    [403, { kind: "rejected", status: 403 }],
    [413, { kind: "rejected", status: 413 }],
  ])("maps status %i to %j", async (status, outcome) => {
    const { push } = await sender(async () => ({ status }));
    expect(await push.send(await device(), MESSAGE, NOW)).toEqual(outcome);
  });

  it("reads Retry-After seconds on a 429 or 503", async () => {
    const { push } = await sender(async () => ({ status: 429, headers: { "retry-after": "120" } }));
    expect(await push.send(await device(), MESSAGE, NOW)).toEqual({
      kind: "retry",
      retryAfterSeconds: 120,
    });
  });

  it("turns a network failure into a retry, never a throw", async () => {
    const { push } = await sender(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await push.send(await device(), MESSAGE, NOW)).toEqual({
      kind: "retry",
      retryAfterSeconds: null,
    });
  });

  it("sends nothing to an endpoint it does not accept, and reports it rejected", async () => {
    const { calls, push } = await sender(async () => ({ status: 201 }));
    const outcome = await push.send(await device("https://evil.example.com/x"), MESSAGE, NOW);
    expect(outcome).toEqual({ kind: "rejected", status: 0 });
    expect(calls).toEqual([]);
  });

  it("reports a malformed device key as rejected without calling the network", async () => {
    const { calls, push } = await sender(async () => ({ status: 201 }));
    const target = { ...(await device()), p256dh: "AAAA" };
    expect(await push.send(target, MESSAGE, NOW)).toEqual({ kind: "rejected", status: 0 });
    expect(calls).toEqual([]);
  });
});

describe("accepts (SSRF guard: the server only POSTs to known push services)", () => {
  it.each([
    "https://web.push.apple.com/QGuQyavXut",
    "https://api.push.apple.com/3/device/abc",
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", async (endpoint) => {
    const { push } = await sender(async () => ({ status: 201 }));
    expect(push.accepts(endpoint)).toBe(true);
  });

  it.each([
    "http://web.push.apple.com/x",
    "https://web.push.apple.com:8443/x",
    "https://user:pass@web.push.apple.com/x",
    "https://push.apple.com.evil.example/x",
    "https://evilpush.apple.com/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "not a url",
    "",
  ])("refuses %j", async (endpoint) => {
    const { push } = await sender(async () => ({ status: 201 }));
    expect(push.accepts(endpoint)).toBe(false);
  });
});
