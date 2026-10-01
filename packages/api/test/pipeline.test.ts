import { describe, expect, it, vi } from "vitest";
import { createPipeline, type PipelineRoute } from "../src/http/pipeline.ts";
import type { ApiResult } from "../src/http/types.ts";

const ORIGIN = "https://app.example";
const ok = (data: unknown): ApiResult => ({ status: 200, data });

function setup(
  overrides: {
    authenticate?: (...args: never[]) => Promise<unknown>;
    onError?: (e: unknown, info: { requestId: string }) => ApiResult | undefined;
  } = {},
) {
  const handle = vi.fn(async (ctx: { actor: string; params: unknown; body: unknown }) =>
    ok({ actor: ctx.actor, params: ctx.params, body: ctx.body }),
  );
  const routes: PipelineRoute<string>[] = [
    { method: "POST", pattern: "/habits", handle },
    { method: "GET", pattern: "/seasons/:seasonId/standings", handle },
    { method: "PATCH", pattern: "/habits/:habitId", handle },
  ];
  const authenticate = vi.fn(
    overrides.authenticate ??
      (async (r: Request) =>
        r.headers.get("authorization") === "Bearer good"
          ? { ok: true as const, actor: "u1" }
          : {
              ok: false as const,
              result: {
                status: 401,
                error: { code: "Unauthorized", message: "Unauthorized" },
              } satisfies ApiResult,
            }),
  );
  const handler = createPipeline<string>({
    routes,
    authenticate: authenticate as never,
    options: { basePath: "/api", allowedOrigins: [ORIGIN], maxBodyBytes: 256 },
    ...(overrides.onError ? { onError: overrides.onError } : {}),
  });
  return { handler, handle, authenticate };
}
const call = (
  handler: (r: Request) => Promise<Response>,
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: string } = {},
) =>
  handler(
    new Request(`http://x${path}`, {
      method,
      headers: { origin: ORIGIN, ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
    }),
  );
const GOOD = { authorization: "Bearer good", "content-type": "application/json" };

describe("createPipeline", () => {
  it("routes an authenticated request and passes actor, params and body", async () => {
    const { handler } = setup();
    const res = await call(handler, "POST", "/api/habits", { headers: GOOD, body: '{"n":1}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { actor: "u1", params: {}, body: { n: 1 } } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("RT-S5: outside the base path is 404 RouteNotFound", async () => {
    const { handler, authenticate } = setup();
    const res = await call(handler, "GET", "/functions/v1/api/seasons/s/standings", {
      headers: GOOD,
    });
    expect(res.status).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("RT-S9: preflight needs no auth and never calls the verifier", async () => {
    const { handler, authenticate } = setup();
    const res = await call(handler, "OPTIONS", "/api/habits", {
      headers: { "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("RT-S10: a preflight from a non-allowed origin has no ACAO and skips auth", async () => {
    const { handler, authenticate } = setup();
    const res = await call(handler, "OPTIONS", "/api/habits", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("RT-S16/S17: 404 and 405 are decided before auth", async () => {
    const { handler, authenticate } = setup();
    expect((await call(handler, "GET", "/api/nope")).status).toBe(404);
    const r405 = await call(handler, "GET", "/api/habits");
    expect(r405.status).toBe(405);
    expect(r405.headers.get("allow")).toBe("POST");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("RT-S12/S13: error responses still carry ACAO", async () => {
    const { handler } = setup();
    const r401 = await call(handler, "POST", "/api/habits");
    expect(r401.status).toBe(401);
    expect(r401.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const r404 = await call(handler, "GET", "/api/nope");
    expect(r404.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await r404.json()).error.code).toBe("RouteNotFound");
  });

  it("auth runs before the body is read: an unauthenticated oversized body is 401", async () => {
    const { handler, handle } = setup();
    const res = await call(handler, "POST", "/api/habits", {
      headers: { "content-type": "application/json" },
      body: "x".repeat(1000),
    });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("body errors surface after auth: 413 and 415, controller not called", async () => {
    const { handler, handle } = setup();
    const big = await call(handler, "POST", "/api/habits", {
      headers: GOOD,
      body: `"${"x".repeat(300)}"`,
    });
    expect(big.status).toBe(413);
    const wrong = await call(handler, "POST", "/api/habits", {
      headers: { ...GOOD, "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrong.status).toBe(415);
    expect(handle).not.toHaveBeenCalled();
  });

  it("RT-S14: a throwing verifier resolves to a 500 envelope without leaking the message", async () => {
    const { handler } = setup({
      authenticate: async () => {
        throw new Error("secret detail");
      },
    });
    const res = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(JSON.parse(text).error.code).toBe("Internal");
  });

  it("a throwing controller is a 500 with the requestId in details", async () => {
    const { handler, handle } = setup();
    handle.mockRejectedValueOnce(new Error("boom"));
    const res = await call(handler, "POST", "/api/habits", { headers: GOOD });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.details.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("reuses a uuid x-request-id and replaces anything else", async () => {
    const { handler } = setup();
    const id = "0b7c6c7e-5f0e-4a3e-9a63-2f6a5d1f7e11";
    const a = await call(handler, "GET", "/api/nope", { headers: { "x-request-id": id } });
    expect(a.headers.get("x-request-id")).toBe(id);
    const b = await call(handler, "GET", "/api/nope", {
      headers: { "x-request-id": "not a uuid" },
    });
    expect(b.headers.get("x-request-id")).not.toBe("not a uuid");
  });

  it("authenticate receives the requestId and the matched route", async () => {
    const { handler, authenticate } = setup();
    const res = await call(handler, "POST", "/api/habits", { headers: GOOD, body: "{}" });
    expect(authenticate).toHaveBeenCalledTimes(1);
    const [, info] = authenticate.mock.calls[0] as unknown as [
      Request,
      { requestId: string; route: { method: string; pattern: string } },
    ];
    expect(info.requestId).toBe(res.headers.get("x-request-id"));
    expect(info.route).toMatchObject({ method: "POST", pattern: "/habits" });
  });

  it("onError maps a thrown error and receives the requestId; undefined keeps the default", async () => {
    const seen: unknown[] = [];
    const { handler, handle } = setup({
      onError: (e, info) => {
        seen.push(e, info.requestId);
        return e instanceof RangeError
          ? { status: 503, error: { code: "ServiceUnavailable", message: "ServiceUnavailable" } }
          : undefined;
      },
    });
    handle.mockRejectedValueOnce(new RangeError("x"));
    const mapped = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(mapped.status).toBe(503);
    expect(seen[1]).toBe(mapped.headers.get("x-request-id"));
    handle.mockRejectedValueOnce(new Error("other"));
    const fallback = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(fallback.status).toBe(500);
    expect((await fallback.json()).error.details.requestId).toBe(
      fallback.headers.get("x-request-id"),
    );
  });

  it("a throwing onError still ends in the default 500", async () => {
    const { handler, handle } = setup({
      onError: () => {
        throw new Error("hook broke");
      },
    });
    handle.mockRejectedValueOnce(new Error("boom"));
    const res = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("Internal");
  });

  it("a BigInt in data becomes a 500 with the requestId; in details it becomes a string", async () => {
    const { handler, handle } = setup();
    handle.mockResolvedValueOnce({ status: 200, data: { n: 1n } });
    const bad = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(bad.status).toBe(500);
    expect((await bad.json()).error.details.requestId).toBe(bad.headers.get("x-request-id"));
    handle.mockResolvedValueOnce({
      status: 422,
      error: { code: "X", message: "X", details: { n: 10n ** 20n } },
    });
    const good = await call(handler, "POST", "/api/habits", { headers: GOOD });
    expect(good.status).toBe(422);
    expect((await good.json()).error.details).toEqual({ n: "100000000000000000000" });
  });

  it("the method is uppercased for routing; HEAD on a GET route is 405 by design", async () => {
    const { handler } = setup();
    const lower = await call(handler, "patch", "/api/habits/h1", { headers: GOOD, body: "{}" });
    expect(lower.status).toBe(200);
    const head = await call(handler, "HEAD", "/api/seasons/s/standings", { headers: GOOD });
    expect(head.status).toBe(405);
    expect(head.headers.get("allow")).toBe("GET");
  });

  it("validates basePath and maxBodyBytes at construction", () => {
    const make = (options: Partial<Parameters<typeof createPipeline>[0]["options"]>) => () =>
      createPipeline<string>({
        routes: [],
        authenticate: (async () => ({ ok: true, actor: "u" })) as never,
        options: { basePath: "/api", allowedOrigins: [], ...options },
      });
    expect(make({})).not.toThrow();
    for (const basePath of ["/api/", "api", "/"]) expect(make({ basePath })).toThrow();
    for (const maxBodyBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(make({ maxBodyBytes })).toThrow();
    }
    expect(make({ maxBodyBytes: 1 })).not.toThrow();
  });
});
