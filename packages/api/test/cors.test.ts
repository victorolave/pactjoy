import { describe, expect, it } from "vitest";
import { createCors } from "../src/http/cors.ts";

const req = (origin?: string, method = "OPTIONS") =>
  new Request("http://x/api/habits", {
    method,
    headers: origin === undefined ? {} : { Origin: origin },
  });

describe("createCors", () => {
  const cors = createCors(["https://app.example"]);

  it("RT-S9: an allowed preflight is 204 with echoed origin and the allow lists", () => {
    const res = cors.preflight(req("https://app.example"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, PATCH, DELETE");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type, x-client-info, apikey, x-request-id",
    );
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("RT-S10: a non-allowed origin gets no CORS headers", () => {
    const res = cors.preflight(req("https://evil.example"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("RT-S11, RT-R6: an empty allow-list allows no origin", () => {
    const none = createCors([]);
    expect(
      none.preflight(req("https://app.example")).headers.get("access-control-allow-origin"),
    ).toBeNull();
  });

  it("origins match exactly: no prefix, suffix or wildcard matching", () => {
    for (const origin of ["https://app.example.evil", "http://app.example", "*", "null", ""]) {
      expect(cors.preflight(req(origin)).headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("RT-S13: decorate adds ACAO and exposes the operational headers to an allowed origin", () => {
    const ok = new Headers();
    cors.decorate(req("https://app.example", "GET"), ok);
    expect(ok.get("access-control-allow-origin")).toBe("https://app.example");
    expect(ok.get("access-control-expose-headers")).toBe("X-Request-Id, Retry-After");
    expect(ok.get("vary")).toBe("Origin");
    const bad = new Headers();
    cors.decorate(req("https://evil.example", "GET"), bad);
    expect(bad.get("access-control-allow-origin")).toBeNull();
    expect(bad.get("access-control-expose-headers")).toBeNull();
  });

  it("Vary: Origin is appended (never replaced) whenever the allow-list is non-empty", () => {
    const h = new Headers({ Vary: "Accept-Encoding" });
    cors.decorate(req("https://app.example", "GET"), h);
    expect(h.get("vary")).toBe("Accept-Encoding, Origin");
    for (const origin of [undefined, "https://evil.example"]) {
      const bare = new Headers();
      cors.decorate(req(origin, "GET"), bare);
      expect(bare.get("vary")).toBe("Origin");
      expect(cors.preflight(req(origin)).headers.get("vary")).toBe("Origin");
    }
  });

  it("an empty allow-list adds nothing, not even Vary", () => {
    const none = createCors([]);
    const h = new Headers();
    none.decorate(req("https://app.example", "GET"), h);
    expect([...h]).toEqual([]);
    expect(none.preflight(req("https://app.example")).headers.get("vary")).toBeNull();
  });

  it("preflight does not depend on `this`", () => {
    const { preflight } = cors;
    expect(preflight(req("https://app.example")).headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
  });

  it("requests without Origin get no ACAO (CORS is not auth)", () => {
    const h = new Headers();
    cors.decorate(req(undefined, "GET"), h);
    expect(h.get("access-control-allow-origin")).toBeNull();
  });
});
