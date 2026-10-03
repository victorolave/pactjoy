import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../ports/auth.ts";
import { GoTrueAuth } from "./gotrue-auth.ts";

const BASE = "http://127.0.0.1:54321";
const KEY = "anon-key";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SESSION_BODY = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: 1_900_000_000,
  user: { id: "user-1", email: "andrea@example.com" },
};

function build(response: Response | Error) {
  const fetchStub = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const auth = new GoTrueAuth({
    baseUrl: BASE,
    anonKey: KEY,
    fetch: fetchStub,
    clock: { nowMs: () => 1_000_000 },
  });
  return { auth, fetchStub };
}

const request = (stub: ReturnType<typeof build>["fetchStub"]) => {
  const [url, init] = stub.mock.calls[0] ?? [];
  return {
    url: String(url),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
};

describe("GoTrueAuth.requestCode", () => {
  it("posts the email to /otp with the anon key and open signup", async () => {
    const { auth, fetchStub } = build(json(200, {}));
    await expect(auth.requestCode("andrea@example.com")).resolves.toBeUndefined();
    const sent = request(fetchStub);
    expect(sent.url).toBe(`${BASE}/auth/v1/otp`);
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("apikey")).toBe(KEY);
    expect(sent.headers.has("Authorization")).toBe(false);
    expect(sent.body).toEqual({ email: "andrea@example.com", create_user: true });
  });

  it.each([
    [422, { error_code: "validation_failed", msg: "bad email" }, "InvalidEmail"],
    [400, { error_code: "email_address_invalid", msg: "bad email" }, "InvalidEmail"],
    [429, { error_code: "over_email_send_rate_limit", msg: "slow down" }, "RateLimited"],
    [500, { msg: "boom" }, "Unknown"],
  ])("maps %i %o to %s", async (status, body, code) => {
    const { auth } = build(json(status, body));
    await expect(auth.requestCode("x@example.com")).rejects.toEqual(new AuthError(code as never));
  });

  it("maps a rejected fetch to Network", async () => {
    const { auth } = build(new TypeError("Failed to fetch"));
    await expect(auth.requestCode("x@example.com")).rejects.toMatchObject({ code: "Network" });
  });
});

describe("GoTrueAuth.verifyCode", () => {
  it("posts type email and returns a Session", async () => {
    const { auth, fetchStub } = build(json(200, SESSION_BODY));
    await expect(auth.verifyCode("andrea@example.com", "123456")).resolves.toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_900_000_000,
      userId: "user-1",
      email: "andrea@example.com",
    });
    const sent = request(fetchStub);
    expect(sent.url).toBe(`${BASE}/auth/v1/verify`);
    expect(sent.body).toEqual({ type: "email", email: "andrea@example.com", token: "123456" });
  });

  it("derives expiresAt from expires_in and allows a null email", async () => {
    const { expires_at: _drop, ...rest } = SESSION_BODY;
    const { auth } = build(
      json(200, { ...rest, expires_in: 3600, user: { id: "user-2", email: null } }),
    );
    await expect(auth.verifyCode("a@example.com", "123456")).resolves.toMatchObject({
      expiresAt: 1000 + 3600,
      userId: "user-2",
      email: null,
    });
  });

  it("maps an expired or invalid code to InvalidCode (one message for both)", async () => {
    for (const body of [
      { error_code: "otp_expired", msg: "Token has expired or is invalid" },
      { error_code: "invalid_credentials", msg: "x" },
    ]) {
      const { auth } = build(json(403, body));
      await expect(auth.verifyCode("a@example.com", "000000")).rejects.toMatchObject({
        code: "InvalidCode",
      });
    }
  });

  it("maps 429 to RateLimited", async () => {
    const { auth } = build(json(429, { error_code: "over_request_rate_limit" }));
    await expect(auth.verifyCode("a@example.com", "000000")).rejects.toMatchObject({
      code: "RateLimited",
    });
  });

  it("maps a 200 without tokens to Unknown", async () => {
    const { auth } = build(json(200, { user: null }));
    await expect(auth.verifyCode("a@example.com", "000000")).rejects.toMatchObject({
      code: "Unknown",
    });
  });
});

describe("GoTrueAuth.refresh and signOut", () => {
  it("exchanges the refresh token on /token", async () => {
    const { auth, fetchStub } = build(json(200, SESSION_BODY));
    const session = await auth.refresh("refresh-0");
    expect(session.accessToken).toBe("access-1");
    const sent = request(fetchStub);
    expect(sent.url).toBe(`${BASE}/auth/v1/token?grant_type=refresh_token`);
    expect(sent.body).toEqual({ refresh_token: "refresh-0" });
  });

  it("classifies refresh failures: definitive rejection vs transient", async () => {
    const cases: Array<[Response | Error, string]> = [
      [json(400, { error_code: "refresh_token_not_found" }), "InvalidSession"],
      [json(400, { error_code: "refresh_token_already_used" }), "InvalidSession"],
      [json(401, { error_code: "session_not_found" }), "InvalidSession"],
      [json(429, { error_code: "over_request_rate_limit" }), "RateLimited"],
      [json(500, { msg: "boom" }), "Unknown"],
      [json(503, {}), "Unknown"],
      [new TypeError("Failed to fetch"), "Network"],
    ];
    for (const [response, code] of cases) {
      await expect(build(response).auth.refresh("r")).rejects.toMatchObject({ code });
    }
  });

  it("signs out with a Bearer token", async () => {
    const { auth, fetchStub } = build(new Response(null, { status: 204 }));
    await expect(auth.signOut("access-1")).resolves.toBeUndefined();
    const sent = request(fetchStub);
    expect(sent.url).toBe(`${BASE}/auth/v1/logout?scope=local`);
    expect(sent.headers.get("Authorization")).toBe("Bearer access-1");
  });

  it("never throws on sign out failures (local sign out must always succeed)", async () => {
    const { auth } = build(new TypeError("Failed to fetch"));
    await expect(auth.signOut("access-1")).resolves.toBeUndefined();
  });
});
