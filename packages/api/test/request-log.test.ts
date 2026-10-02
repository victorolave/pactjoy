import { userId } from "@pactjoy/app";
import { createTestApp } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { createConsoleLogger } from "../src/composition/logger.ts";
import { createThrownMapper } from "../src/errors/thrown.ts";
import { createPipeline } from "../src/http/pipeline.ts";
import type { ApiResult } from "../src/http/types.ts";
import { createApi } from "../src/routes/index.ts";
import { createDeterministicUuidGenerator, createFakeTokenVerifier } from "../src/testing/index.ts";

const RID = "11111111-2222-4333-8444-555555555555";
const ANDREA_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SECRET_TOKEN = "super-secret-token";

function setup(
  handle: () => Promise<ApiResult> = async () => ({
    status: 200,
    data: {},
  }),
) {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const logger = { info, warn, error };
  let t = 1000;
  const now = vi.fn(() => {
    t += 25;
    return t;
  });
  const handler = createPipeline<string>({
    routes: [{ method: "GET", pattern: "/habits/:habitId", handle }],
    authenticate: async (r) =>
      r.headers.get("authorization") === `Bearer ${SECRET_TOKEN}`
        ? { ok: true, actor: "user-77" }
        : {
            ok: false,
            result: { status: 401, error: { code: "Unauthorized", message: "Unauthorized" } },
          },
    options: { basePath: "/api", allowedOrigins: [] },
    onError: createThrownMapper(undefined, logger),
    logger,
    now,
  });
  return { handler, info, warn, error };
}
const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://x${path}`, {
    headers: { "x-request-id": RID, authorization: `Bearer ${SECRET_TOKEN}` },
    ...init,
  });

describe("request log line (SF3)", () => {
  it("logs the pattern, never the raw path, with status and duration", async () => {
    const { handler, info } = setup();
    await handler(req("/api/habits/abc-secret-id?x=1"));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("request", {
      requestId: RID,
      method: "GET",
      route: "/habits/:habitId",
      status: 200,
      durationMs: 25,
    });
    const text = JSON.stringify(info.mock.calls);
    for (const leak of ["abc-secret-id", SECRET_TOKEN, "user-77", "x=1"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("401 logs the line with the matched pattern and its code", async () => {
    const { handler, info } = setup();
    await handler(req("/api/habits/h", { headers: { "x-request-id": RID } }));
    expect(info.mock.calls[0]?.[1]).toMatchObject({
      status: 401,
      code: "Unauthorized",
      route: "/habits/:habitId",
    });
  });

  it("404 and 405 log the line as unmatched, never the raw path", async () => {
    const { handler, info } = setup();
    await handler(req("/api/nothing-secret"));
    await handler(req("/api/habits/h", { method: "DELETE" }));
    expect(info.mock.calls[0]?.[1]).toMatchObject({
      status: 404,
      code: "RouteNotFound",
      route: "unmatched",
    });
    expect(info.mock.calls[1]?.[1]).toMatchObject({
      status: 405,
      code: "MethodNotAllowed",
      route: "unmatched",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("nothing-secret");
  });

  it("a preflight logs the line with route preflight", async () => {
    const { handler, info } = setup();
    await handler(
      new Request("http://x/api/habits/h", {
        method: "OPTIONS",
        headers: {
          "x-request-id": RID,
          origin: "http://o",
          "access-control-request-method": "GET",
        },
      }),
    );
    expect(info.mock.calls[0]?.[1]).toMatchObject({ method: "OPTIONS", route: "preflight" });
  });

  it("422 from the body stage logs the line with its code", async () => {
    const info = vi.fn();
    const handler = createPipeline<string>({
      routes: [
        { method: "POST", pattern: "/habits", handle: async () => ({ status: 200, data: {} }) },
      ],
      authenticate: async () => ({ ok: true, actor: "u" }),
      options: { basePath: "", allowedOrigins: [] },
      logger: { info, warn: vi.fn(), error: vi.fn() },
    });
    const res = await handler(
      new Request("http://x/habits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(info.mock.calls[0]?.[1]).toMatchObject({ status: res.status, route: "/habits" });
    expect(info.mock.calls[0]?.[1]).toHaveProperty("code");
  });

  it("a thrown 500 logs the line with code Internal", async () => {
    const { handler, info } = setup(async () => {
      throw new Error("boom");
    });
    await handler(req("/api/habits/h"));
    expect(info.mock.calls[0]?.[1]).toMatchObject({ status: 500, code: "Internal" });
  });

  it("a throwing logger never breaks the response", async () => {
    const { handler, info } = setup();
    info.mockImplementation(() => {
      throw new Error("sink down");
    });
    expect((await handler(req("/api/habits/h"))).status).toBe(200);
  });
});

describe("thrown-error log (SF2)", () => {
  it("logs name and code (not the message) of a coded 500 through the logger, body unchanged", async () => {
    const { handler, error } = setup(async () => {
      throw Object.assign(new Error("db exploded"), { code: "XX000" });
    });
    const res = await handler(req("/api/habits/h"));
    expect(await res.json()).toEqual({
      error: { code: "Internal", message: "Internal", details: { requestId: RID } },
    });
    expect(error).toHaveBeenCalledWith("request.failed", {
      requestId: RID,
      error: { name: "Error", code: "XX000" },
    });
  });

  it("logs a 503 too, and leaves 409 unlogged", () => {
    const error = vi.fn();
    const map = createThrownMapper((e) => e instanceof RangeError, {
      info: vi.fn(),
      warn: vi.fn(),
      error,
    });
    map(new RangeError("down"), { requestId: "r" });
    expect(error).toHaveBeenCalledTimes(1);
    map(Object.assign(new Error("x"), { name: "ConcurrencyConflict" }), { requestId: "r" });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("the console logger scrubs the logged message and has an info level", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger((l) => lines.push(l));
    createThrownMapper(undefined, logger)(new Error("bad postgres://u:pw@h/db"), {
      requestId: "r",
    });
    logger.info("request", { requestId: "r" });
    expect(lines[0]).not.toContain("pw@");
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ level: "info", event: "request" });
  });
});

describe("full pipeline logging (createApi)", () => {
  const build = (error: () => void) => {
    const app = createTestApp();
    const boom = new RangeError("pg down");
    const uow = {
      read: async () => {
        throw boom;
      },
      transaction: async () => {
        throw boom;
      },
    } as unknown as typeof app.uow;
    return createApi(
      {
        uow,
        clock: app.clock,
        timeZone: app.timeZone,
        ids: createDeterministicUuidGenerator(),
        random: app.random,
        tokenVerifier: createFakeTokenVerifier({ andrea: userId(ANDREA_ID) }),
        logger: { info: vi.fn(), warn: vi.fn(), error },
        isUnavailable: (e) => e === boom,
      },
      { basePath: "/api", allowedOrigins: [] },
    );
  };
  const get = (h: ReturnType<typeof build>) =>
    h(
      new Request("http://x/api/circles", {
        method: "POST",
        headers: { authorization: "Bearer andrea", "content-type": "application/json" },
        body: JSON.stringify({ name: "c", displayName: "Ana" }),
      }),
    );

  it("the 503 path is logged through createApi", async () => {
    const error = vi.fn();
    const res = await get(build(error));
    expect(res.status).toBe(503);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe("request.failed");
  });

  it("a throwing error logger does not change the 500 response", async () => {
    const { handler, error } = setup(async () => {
      throw new Error("boom");
    });
    error.mockImplementation(() => {
      throw new Error("sink down");
    });
    const res = await handler(req("/api/habits/h"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "Internal", message: "Internal", details: { requestId: RID } },
    });
  });

  it("a throwing error logger keeps the 503 a 503", async () => {
    const error = vi.fn(() => {
      throw new Error("sink down");
    });
    expect((await get(build(error))).status).toBe(503);
  });
});
