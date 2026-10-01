import { type Actor, userId } from "@pactjoy/app";
import { describe, expect, it, vi } from "vitest";
import { createAuthGuard } from "../src/auth/auth-guard.ts";
import type { TokenRejection, TokenVerifier } from "../src/auth/token-verifier.port.ts";
import { createPipeline, type PipelineRoute } from "../src/http/pipeline.ts";
import { createFakeTokenVerifier } from "../src/testing/index.ts";

const ALICE = userId("0190a000-0000-7000-8000-000000000001");
const request = (authorization?: string) =>
  new Request("http://x/api/habits", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });

const ROUTE: PipelineRoute<Actor> = {
  method: "POST",
  pattern: "/habits",
  handle: async () => ({ status: 200, data: 1 }),
};
const INFO = { requestId: "req-1", route: ROUTE };

function setup(verifier: TokenVerifier = createFakeTokenVerifier({ good: ALICE })) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { authenticate: createAuthGuard({ verifier, logger }), logger };
}

async function rejected(authorization?: string) {
  const outcome = await setup().authenticate(request(authorization), INFO);
  if (outcome.ok) throw new Error("expected a rejection");
  return outcome;
}

describe("auth guard", () => {
  it("AU-S1: a valid Bearer token yields the actor", async () => {
    const outcome = await setup().authenticate(request("Bearer good"), INFO);
    expect(outcome).toEqual({ ok: true, actor: { userId: ALICE } satisfies Actor });
  });

  it("the Bearer scheme is case-insensitive", async () => {
    expect((await setup().authenticate(request("bEaReR good"), INFO)).ok).toBe(true);
  });

  it("AU-S2, AU-S3: missing, non-Bearer and malformed headers give 401 with WWW-Authenticate", async () => {
    for (const header of [
      undefined,
      "good",
      "Basic good",
      "Bearer",
      "Bearer ",
      "Bearer a b",
      `Bearer ${"a".repeat(8193)}`,
    ]) {
      const outcome = await rejected(header);
      expect(outcome.result).toEqual({
        status: 401,
        error: { code: "Unauthorized", message: "Unauthorized" },
      });
      expect(new Headers(outcome.headers).get("www-authenticate")).toBe(
        'Bearer error="invalid_token"',
      );
    }
  });

  it("AU-S4: every rejection reason gives a byte-identical 401 (no oracle) and is logged", async () => {
    const reasons: TokenRejection["reason"][] = [
      "malformed",
      "expired",
      "invalidSignature",
      "unsupportedAlgorithm",
      "wrongIssuer",
      "wrongAudience",
      "notAuthenticated",
      "invalidSubject",
    ];
    const seen = new Set<string>();
    for (const reason of reasons) {
      const { authenticate, logger } = setup({
        verify: async () => ({ ok: false, error: { reason } }),
      });
      const outcome = await authenticate(request("Bearer secret-token"), INFO);
      if (outcome.ok) throw new Error("expected a rejection");
      seen.add(JSON.stringify([outcome.result, [...new Headers(outcome.headers)]]));
      expect(logger.warn).toHaveBeenCalledWith("auth.rejected", { reason, requestId: "req-1" });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token");
    }
    expect(seen.size).toBe(1);
  });

  it("AU-S5: an unknown token is rejected by the fake verifier as invalidSignature", async () => {
    const { authenticate, logger } = setup();
    expect((await authenticate(request("Bearer nope"), INFO)).ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("auth.rejected", {
      reason: "invalidSignature",
      requestId: "req-1",
    });
  });

  it("AU-S6: a missing header logs a reason without a token", async () => {
    const { authenticate, logger } = setup();
    await authenticate(request(), INFO);
    expect(logger.warn).toHaveBeenCalledWith("auth.rejected", {
      reason: "malformed",
      requestId: "req-1",
    });
  });

  it("keysUnavailable gives 503 ServiceUnavailable with Retry-After", async () => {
    const { authenticate, logger } = setup({
      verify: async () => ({ ok: false, error: { reason: "keysUnavailable", requestId: "req-1" } }),
    });
    const outcome = await authenticate(request("Bearer good"), INFO);
    if (outcome.ok) throw new Error("expected a rejection");
    expect(outcome.result).toEqual({
      status: 503,
      error: { code: "ServiceUnavailable", message: "ServiceUnavailable" },
    });
    expect(new Headers(outcome.headers).get("retry-after")).toBe("5");
    expect(logger.warn).toHaveBeenCalledWith("auth.rejected", {
      reason: "keysUnavailable",
      requestId: "req-1",
    });
  });

  it("the verifier is not called for a missing or oversized token", async () => {
    const verify = vi.fn();
    const { authenticate } = setup({ verify });
    await authenticate(request(), INFO);
    await authenticate(request(`Bearer ${"a".repeat(8193)}`), INFO);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("auth guard in the pipeline", () => {
  it("RT-S12: 401 carries the envelope, WWW-Authenticate, CORS and no-store", async () => {
    const { authenticate } = setup();
    const handler = createPipeline({
      routes: [
        { method: "POST", pattern: "/habits", handle: async () => ({ status: 200, data: 1 }) },
      ],
      authenticate,
      options: { basePath: "/api", allowedOrigins: ["https://app.example"] },
    });
    const res = await handler(
      new Request("http://x/api/habits", {
        method: "POST",
        headers: { origin: "https://app.example" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "Unauthorized", message: "Unauthorized" } });
  });

  it("the rejection log carries the same request id the client receives in X-Request-Id", async () => {
    const { authenticate, logger } = setup();
    const handler = createPipeline({
      routes: [ROUTE],
      authenticate,
      options: { basePath: "/api", allowedOrigins: [] },
    });
    const res = await handler(request("Bearer nope"));
    expect(res.status).toBe(401);
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    expect(logger.warn).toHaveBeenCalledWith("auth.rejected", {
      reason: "invalidSignature",
      requestId,
    });
  });
});
