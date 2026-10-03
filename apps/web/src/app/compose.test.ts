import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { fakeSession } from "../testing/fake-auth.ts";
import { MemoryTokenStore } from "../testing/memory-token-store.ts";
import { createDependencies } from "./compose.ts";

const CONFIG: AppConfig = {
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseAnonKey: "anon-key",
  apiBaseUrl: "http://127.0.0.1:54321/functions/v1/api",
};

describe("createDependencies", () => {
  it("wires GoTrue auth to the configured Supabase URL with the anon key", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const { auth } = createDependencies(CONFIG, { fetch: fetchStub });
    await auth.requestCode("andrea@example.com");
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:54321/auth/v1/otp");
    expect(new Headers(init?.headers).get("apikey")).toBe("anon-key");
  });

  it("shares one session event channel and one query client", () => {
    const deps = createDependencies(CONFIG, { fetch: vi.fn<typeof fetch>() });
    const expired = vi.fn();
    deps.sessionEvents.onExpire(expired);
    deps.sessionEvents.expire();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(deps.queryClient).toBeDefined();
  });

  it("starts signed out when nothing is stored", async () => {
    const deps = createDependencies(CONFIG, {
      fetch: vi.fn<typeof fetch>(),
      store: undefined,
    });
    await expect(deps.sessions.getAccessToken()).resolves.toBeNull();
  });

  it("wires the API to the configured base URL with the stored access token", async () => {
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: { state: "noCircle" } }), { status: 200 }),
    );
    const store = new MemoryTokenStore(
      fakeSession({ expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    );
    const { api } = createDependencies(CONFIG, { fetch: fetchStub, store });
    await expect(api.getToday()).resolves.toEqual({ state: "noCircle" });
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:54321/functions/v1/api/me/today");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-1");
  });

  it("expires the session when the API stays unauthorized after one refresh (AU-R5)", async () => {
    const unauthorized = () =>
      new Response(JSON.stringify({ error: { code: "Unauthorized", message: "no" } }), {
        status: 401,
      });
    const session = fakeSession({ expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    const fetchStub = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/auth/v1/token")
        ? new Response(
            JSON.stringify({
              access_token: "access-2",
              refresh_token: "refresh-2",
              expires_at: session.expiresAt,
              user: { id: "user-1", email: null },
            }),
            { status: 200 },
          )
        : unauthorized(),
    );
    const deps = createDependencies(CONFIG, {
      fetch: fetchStub,
      store: new MemoryTokenStore(session),
    });
    const expired = vi.fn();
    deps.sessionEvents.onExpire(expired);
    await expect(deps.api.getToday()).rejects.toMatchObject({ code: "Unauthorized" });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does not expire the session when the refresh fails for a transient reason", async () => {
    const session = fakeSession({ expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/auth/v1/token")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ error: { code: "Unauthorized", message: "no" } }), {
        status: 401,
      });
    });
    const store = new MemoryTokenStore(session);
    const deps = createDependencies(CONFIG, { fetch: fetchStub, store });
    const expired = vi.fn();
    deps.sessionEvents.onExpire(expired);
    await expect(deps.api.getToday()).rejects.toMatchObject({ code: "ServiceUnavailable" });
    expect(expired).not.toHaveBeenCalled();
    expect(store.load()).not.toBeNull();
  });
});
