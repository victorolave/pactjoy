import { describe, expect, it, vi } from "vitest";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

/** The device's Web Push calls (ADR-0017): the public key, and register or remove this device. */

const BASE = "http://api.test/api";
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const DEVICE = {
  endpoint: "https://web.push.apple.com/device-1",
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

function harness(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => "t1",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized: () => {},
    fetch: fetchStub,
  });
  const sent = () => {
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    return {
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
  };
  return { api, sent };
}

describe("HttpPactJoyApi push methods", () => {
  it("getPushConfig reads GET /me/push-config", async () => {
    const { api, sent } = harness(json(200, { data: { vapidPublicKey: "BKEY" } }));
    await expect(api.getPushConfig()).resolves.toEqual({ vapidPublicKey: "BKEY" });
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/push-config`]);
  });

  it("getPushConfig accepts a server without push (null key)", async () => {
    const { api } = harness(json(200, { data: { vapidPublicKey: null } }));
    await expect(api.getPushConfig()).resolves.toEqual({ vapidPublicKey: null });
  });

  it("getPushConfig turns a body of another shape into ApiError(Internal)", async () => {
    const { api } = harness(json(200, { data: { vapidPublicKey: 7 } }));
    await expect(api.getPushConfig()).rejects.toMatchObject({ code: "Internal" });
  });

  it("savePushSubscription PUTs the device's endpoint and keys", async () => {
    const { api, sent } = harness(json(200, { data: null }));
    await api.savePushSubscription(DEVICE);
    expect(sent()).toEqual({ method: "PUT", url: `${BASE}/me/push-subscription`, body: DEVICE });
  });

  it("removePushSubscription POSTs the endpoint to /me/push-subscription/remove", async () => {
    const { api, sent } = harness(json(200, { data: null }));
    await api.removePushSubscription(DEVICE.endpoint);
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/me/push-subscription/remove`,
      body: { endpoint: DEVICE.endpoint },
    });
  });
});
