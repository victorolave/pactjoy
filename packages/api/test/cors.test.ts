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
      "authorization, content-type, x-client-info, apikey",
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

  it("RT-S13: decorate adds ACAO and Vary to an allowed origin only", () => {
    const ok = new Headers();
    cors.decorate(req("https://app.example", "GET"), ok);
    expect(ok.get("access-control-allow-origin")).toBe("https://app.example");
    expect(ok.get("vary")).toBe("Origin");
    const bad = new Headers();
    cors.decorate(req("https://evil.example", "GET"), bad);
    expect(bad.get("access-control-allow-origin")).toBeNull();
  });

  it("requests without Origin are untouched (CORS is not auth)", () => {
    const h = new Headers();
    cors.decorate(req(undefined, "GET"), h);
    expect([...h]).toEqual([]);
  });
});
