import { describe, expect, it, vi } from "vitest";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

/** Deleting the account (ADR-0019): one DELETE /me with the typed word in a JSON body. */

const BASE = "http://api.test/api";
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function harness(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  const onUnauthorized = vi.fn();
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => "t1",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized,
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
  return { api, sent, onUnauthorized };
}

describe("HttpPactJoyApi deleteAccount", () => {
  it("DELETEs /me with the confirmation word in the body", async () => {
    const { api, sent } = harness(json(200, { data: null }));
    await expect(api.deleteAccount()).resolves.toBeUndefined();
    expect(sent()).toEqual({
      method: "DELETE",
      url: `${BASE}/me`,
      body: { confirmation: "ELIMINAR" },
    });
  });

  it("rejects with the server's code when the deletion is refused", async () => {
    const { api } = harness(
      json(503, { error: { code: "IdentityUnavailable", message: "x", requestId: "r1" } }),
    );
    await expect(api.deleteAccount()).rejects.toMatchObject({
      code: "IdentityUnavailable",
      status: 503,
    });
  });

  it("ends the session when the server answers 401 after the refresh attempt", async () => {
    const { api, onUnauthorized } = harness(
      json(401, { error: { code: "Unauthorized", message: "x", requestId: "r1" } }),
    );
    await expect(api.deleteAccount()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
