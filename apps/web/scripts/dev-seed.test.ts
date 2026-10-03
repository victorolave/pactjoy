import { describe, expect, it, vi } from "vitest";
import { isLocalUrl, runSeed } from "./dev-seed.ts";

const ENV = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "anon-key",
  VITE_API_BASE_URL: "http://127.0.0.1:54321/functions/v1/api",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly auth: string | null;
  readonly body: unknown;
}

type Handler = (call: Recorded) => Response | undefined;

function harness(env: Record<string, string | undefined> = ENV, override?: Handler) {
  const calls: Recorded[] = [];
  let habits = 0;
  const fetchStub = vi.fn<typeof fetch>(async (input, init) => {
    const call: Recorded = {
      method: init?.method ?? "GET",
      url: String(input),
      auth: new Headers(init?.headers).get("Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const custom = override?.(call);
    if (custom) return custom;
    if (call.url.endsWith("/auth/v1/otp")) return json(200, {});
    if (call.url.endsWith("/auth/v1/verify")) {
      return json(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_at: 2_000_000_000,
        user: { id: "user-1", email: "dev@pactjoy.local" },
      });
    }
    if (call.url.endsWith("/circles")) return json(201, { data: { id: "circle-1" } });
    if (call.url.endsWith("/circles/circle-1/seasons")) {
      return json(201, { data: { id: "season-1", pactRevision: 0 } });
    }
    if (call.url.endsWith("/habits")) return json(201, { data: { id: `habit-${++habits}` } });
    if (call.url.endsWith("/seasons/season-1/commitments")) {
      return json(201, { data: { id: "season-1", pactRevision: calls.length } });
    }
    if (call.url.endsWith("/seasons/season-1/approval")) {
      return json(200, { data: { id: "season-1", status: "active" } });
    }
    return json(404, { error: { code: "RouteNotFound", message: "x" } });
  });
  const log = vi.fn<(message: string) => void>();
  const run = () =>
    runSeed({
      env,
      fetch: fetchStub,
      readCode: async () => "123456",
      log,
      now: () => new Date("2026-10-02T15:00:00Z"),
      timeZone: "America/Bogota",
    });
  return { calls, fetchStub, log, run };
}

describe("isLocalUrl", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321/functions/v1/api", true],
    ["https://abc.supabase.co", false],
    ["http://127.0.0.1.evil.com", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalUrl(url)).toBe(expected);
  });
});

describe("runSeed safety", () => {
  it("refuses a non-local Supabase URL without any request (WF-R8)", async () => {
    const { run, fetchStub, log } = harness({
      ...ENV,
      VITE_SUPABASE_URL: "https://abc.supabase.co",
    });
    await expect(run()).resolves.toBe(1);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(log.mock.calls.join("\n")).toMatch(/local/i);
  });

  it("refuses a non-local API URL", async () => {
    const { run, fetchStub } = harness({ ...ENV, VITE_API_BASE_URL: "https://api.example.com" });
    await expect(run()).resolves.toBe(1);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses when the configuration is missing", async () => {
    const { run, fetchStub } = harness({});
    await expect(run()).resolves.toBe(1);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("runSeed", () => {
  it("creates a circle, a 4 week season, 4 habits and 4 commitments, then approves the pact", async () => {
    const { run, calls } = harness();
    await expect(run()).resolves.toBe(0);

    const api = calls.filter((c) => c.url.startsWith(ENV.VITE_API_BASE_URL));
    expect(api.map((c) => `${c.method} ${c.url.slice(ENV.VITE_API_BASE_URL.length)}`)).toEqual([
      "POST /circles",
      "POST /circles/circle-1/seasons",
      ...Array.from({ length: 4 }, () => [
        "POST /habits",
        "POST /seasons/season-1/commitments",
      ]).flat(),
      "PUT /seasons/season-1/approval",
    ]);
    expect(api.every((c) => c.auth === "Bearer access-1")).toBe(true);
    expect(api[1]?.body).toMatchObject({
      timezone: "America/Bogota",
      startDate: "2026-10-02",
      lengthWeeks: 4,
    });
  });

  it("uses weights that add up to 100 and the pact revision of the last commitment", async () => {
    const { run, calls } = harness();
    await run();
    const commitments = calls.filter((c) => c.url.endsWith("/commitments"));
    const weights = commitments.map((c) => (c.body as { weightPercent: number }).weightPercent);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    const approval = calls.find((c) => c.url.endsWith("/approval"));
    const lastRevisionIndex = calls.indexOf(commitments[3] as Recorded) + 1;
    expect(approval?.body).toEqual({ expectedPactRevision: lastRevisionIndex });
  });

  it("covers a done, a perSession, a weeklyTotal and a limit measure", async () => {
    const { run, calls } = harness();
    await run();
    const measures = calls
      .filter((c) => c.url.endsWith("/commitments"))
      .map((c) => (c.body as { measure: Record<string, unknown> }).measure);
    expect(measures.map((m) => m.unit)).toEqual(["done", "minutes", "km", "times"]);
    expect(measures.map((m) => m.direction)).toEqual([undefined, "reach", "reach", "limit"]);
  });

  it("exits 0 with a hint when the user already is in an active circle", async () => {
    const { run, log, calls } = harness(ENV, (call) =>
      call.url.endsWith("/circles") && call.method === "POST"
        ? json(409, { error: { code: "AlreadyInActiveCircle", message: "x" } })
        : undefined,
    );
    await expect(run()).resolves.toBe(0);
    expect(log.mock.calls.join("\n")).toContain("supabase db reset");
    expect(calls.some((c) => c.url.endsWith("/habits"))).toBe(false);
  });

  it("exits 1 on any other API error", async () => {
    const { run } = harness(ENV, (call) =>
      call.url.endsWith("/habits")
        ? json(422, { error: { code: "InvalidName", message: "x" } })
        : undefined,
    );
    await expect(run()).resolves.toBe(1);
  });

  it("exits 1 when the code is wrong", async () => {
    const { run } = harness(ENV, (call) =>
      call.url.endsWith("/verify") ? json(403, { error_code: "otp_expired" }) : undefined,
    );
    await expect(run()).resolves.toBe(1);
  });
});
