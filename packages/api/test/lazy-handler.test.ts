import { userId } from "@pactjoy/app";
import { createTestApp } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { describeEnvError, loadApiEnv } from "../src/composition/config.ts";
import { createLazyHandler } from "../src/composition/lazy-handler.ts";
import { createConsoleLogger } from "../src/composition/logger.ts";
import type { Handler } from "../src/http/types.ts";
import { createApi } from "../src/routes/index.ts";
import { createDeterministicUuidGenerator, createFakeTokenVerifier } from "../src/testing/index.ts";

const ANDREA = userId("aaaaaaaa-0000-4000-8000-000000000001");
const SECRET = "postgres://u:secret@h:6543/db";

/** A counting stand-in for the production wiring: `connect` plays the role of the pool opening. */
function composition() {
  const app = createTestApp();
  const built = vi.fn();
  const connected = vi.fn();
  const verify = vi.fn();
  const lines: string[] = [];
  const logger = createConsoleLogger((line) => lines.push(line));
  const build = (): Handler => {
    built();
    const touch = <T>(run: () => Promise<T>) => {
      connected();
      return run();
    };
    const fake = createFakeTokenVerifier({ andrea: ANDREA });
    return createApi(
      {
        uow: {
          transaction: (fn) => touch(() => app.uow.transaction(fn)),
          read: (fn) => touch(() => app.uow.read(fn)),
        },
        clock: app.clock,
        timeZone: app.timeZone,
        ids: createDeterministicUuidGenerator(),
        random: app.random,
        tokenVerifier: {
          verify: (token) => {
            verify(token);
            return fake.verify(token);
          },
        },
        logger,
      },
      { basePath: "/api", allowedOrigins: [] },
    );
  };
  return { built, connected, verify, lines, logger, build };
}

const request = (method: string, path: string, token?: string, body?: unknown) =>
  new Request(`http://x/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("createApi (AC-S1)", () => {
  it("returns a function and performs no I/O at construction", () => {
    const { build, built, connected, verify } = composition();
    const handler = build();
    expect(typeof handler).toBe("function");
    expect([
      built.mock.calls.length,
      connected.mock.calls.length,
      verify.mock.calls.length,
    ]).toEqual([1, 0, 0]);
  });
});

describe("createLazyHandler (AC-S4)", () => {
  it("builds nothing until the first request, then once per isolate", async () => {
    const { build, built, logger } = composition();
    const handler = createLazyHandler(build, { logger });
    expect(built).not.toHaveBeenCalled();
    await handler(request("GET", "/nope"));
    await handler(request("GET", "/nope"));
    await handler(request("POST", "/circles", "andrea", { name: "Crew" }));
    expect(built).toHaveBeenCalledTimes(1);
  });

  it("401/404/405/422 never reach the pool; the first valid request does; later ones reuse it", async () => {
    const { build, connected, logger } = composition();
    const handler = createLazyHandler(build, { logger });
    const early = [
      request("POST", "/circles", undefined, { name: "Crew" }),
      request("POST", "/circles", "bogus", { name: "Crew" }),
      request("GET", "/nowhere", "andrea"),
      request("DELETE", "/circles", "andrea"),
      request("POST", "/circles", "andrea", { name: "Crew", extra: true }),
    ];
    const statuses: number[] = [];
    for (const r of early) statuses.push((await handler(r)).status);
    expect(statuses).toEqual([401, 401, 404, 405, 422]);
    expect(connected).not.toHaveBeenCalled();

    expect((await handler(request("POST", "/circles", "andrea", { name: "Crew" }))).status).toBe(
      201,
    );
    expect(connected).toHaveBeenCalledTimes(1);
    expect((await handler(request("POST", "/habits", "andrea", { name: "Run" }))).status).toBe(201);
    expect(connected).toHaveBeenCalledTimes(2); // one use-case call each; the factory ran once
  });

  it("DE-S12: a build failure is a 503 ServiceUnavailable, retried on the next request", async () => {
    const { build, lines, logger } = composition();
    let attempts = 0;
    const flaky = (): Handler => {
      attempts += 1;
      if (attempts === 1) {
        const env = loadApiEnv((name) => ({ SUPABASE_URL: "https://abc.supabase.co" })[name]);
        if (!env.ok) throw new Error(describeEnvError(env.error));
      }
      return build();
    };
    const handler = createLazyHandler(flaky, { logger });
    const first = await handler(request("GET", "/seasons/x/score", "andrea"));
    expect(first.status).toBe(503);
    expect(first.headers.get("retry-after")).toBe("5");
    expect(first.headers.get("access-control-allow-origin")).toBeNull();
    expect(await first.json()).toEqual({
      error: { code: "ServiceUnavailable", message: "ServiceUnavailable" },
    });
    expect(lines.join("\n")).toContain("API_DATABASE_URL");

    const second = await handler(request("POST", "/circles", "andrea", { name: "Crew" }));
    expect(second.status).toBe(201);
    expect(attempts).toBe(2);
    await handler(request("GET", "/nope"));
    expect(attempts).toBe(2); // built handler is memoized after the successful retry
  });

  it("a build failure never leaks the thrown message beyond 200 characters or its secrets", async () => {
    const lines: string[] = [];
    const handler = createLazyHandler(
      () => {
        throw new Error(`boom ${"x".repeat(500)}`);
      },
      { logger: createConsoleLogger((line) => lines.push(line)) },
    );
    const response = await handler(request("GET", "/nope"));
    expect(response.status).toBe(503);
    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0] ?? "{}") as { error: { name: string; message: string } };
    expect(logged.error.name).toBe("Error");
    expect(logged.error.message.length).toBeLessThanOrEqual(201);
  });
});

describe("logging (AU-S15, log half)", () => {
  it("captures no token, body, note, invite code, user id or database url across requests", async () => {
    const { build, lines, logger } = composition();
    const handler = createLazyHandler(build, { logger });
    const token = "tok-super-secret-value";
    await handler(request("GET", "/circles/x/nope", token));
    await handler(request("POST", "/circles", token, { name: "Crew" }));
    await handler(request("POST", "/circles", "andrea", { name: "Crew", note: "private words" }));
    await handler(request("POST", "/circles/join", "andrea", { inviteCode: "ABCDEF" }));
    await handler(request("POST", "/circles/join", "andrea", { inviteCode: "zz-bad-code" }));
    const logged = lines.join("\n");
    expect(logged).toContain("auth.rejected"); // something WAS logged
    for (const leak of [token, "private words", "ABCDEF", "zz-bad-code", ANDREA, SECRET]) {
      expect(logged).not.toContain(leak);
    }
  });
});

describe("createConsoleLogger", () => {
  it("emits one JSON line per event with level, event and fields", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger((line) => lines.push(line));
    logger.warn("auth.rejected", { reason: "expired", requestId: "r1" });
    logger.error("composition.failed", { name: "Error" });
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { level: "warn", event: "auth.rejected", reason: "expired", requestId: "r1" },
      { level: "error", event: "composition.failed", name: "Error" },
    ]);
  });

  it("drops sensitive field names whatever their case and truncates long strings", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger((line) => lines.push(line));
    logger.error("x", {
      Authorization: "Bearer abc",
      token: "t",
      body: "{}",
      note: "n",
      inviteCode: "ABCDEF",
      userId: "u",
      databaseUrl: SECRET,
      detail: "d",
      where: "w",
      message: "m".repeat(500),
    });
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, string>;
    expect(Object.keys(parsed).sort()).toEqual(["event", "level", "message"]);
    expect(parsed.message?.length).toBeLessThanOrEqual(201);
  });

  it("never throws, even for BigInt or circular fields", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger((line) => lines.push(line));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.warn("x", { big: 1n, circular })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
