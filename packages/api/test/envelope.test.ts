import { describe, expect, it } from "vitest";
import { respond } from "../src/http/envelope.ts";

describe("respond", () => {
  it("RT-S1: success is {data} with JSON content type and security headers", async () => {
    const res = respond({ status: 201, data: { id: "x" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ data: { id: "x" } });
  });

  it("keeps null data (uniform envelope)", async () => {
    expect(await respond({ status: 200, data: null }).json()).toEqual({ data: null });
  });

  it("RT-S2: errors are {error} only, with no data key", async () => {
    const res = respond({
      status: 404,
      error: { code: "RouteNotFound", message: "RouteNotFound" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "RouteNotFound", message: "RouteNotFound" },
    });
  });

  it("RT-S3: BigInt-bearing details serialize as strings without throwing", async () => {
    const res = respond({
      status: 422,
      error: { code: "X", message: "X", details: { n: 10n ** 20n } },
    });
    expect(await res.json()).toEqual({
      error: { code: "X", message: "X", details: { n: "100000000000000000000" } },
    });
  });

  it("falls back to a 500 Internal envelope when serialization fails", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const res = respond({ status: 200, data: cyclic });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "Internal", message: "Internal" } });
  });

  it("merges extra headers without letting them override the fixed ones", () => {
    const res = respond(
      { status: 405, error: { code: "MethodNotAllowed", message: "MethodNotAllowed" } },
      { Allow: "POST", "Content-Type": "text/html" },
    );
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});
