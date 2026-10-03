import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
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
});
