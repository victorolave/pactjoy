import { describe, expect, it } from "vitest";
import { createRouter, stripBasePath } from "../src/http/router.ts";
import type { HttpMethod } from "../src/http/types.ts";

const route = (method: HttpMethod, pattern: string) => ({ method, pattern });
const router = createRouter([
  route("POST", "/habits"),
  route("POST", "/circles/join"),
  route("POST", "/circles/join/preview"),
  route("POST", "/circles/:circleId/leave"),
  route("PATCH", "/circles/:circleId"),
  route("GET", "/seasons/:seasonId/standings"),
  route("PUT", "/seasons/:seasonId/commitments/:commitmentId"),
  route("DELETE", "/seasons/:seasonId/commitments/:commitmentId"),
]);

describe("stripBasePath (RT-S5, RT-S6)", () => {
  it("returns the remainder under the base path", () => {
    expect(stripBasePath("/functions/v1/api/habits", "/functions/v1/api")).toBe("/habits");
    expect(stripBasePath("/api/habits", "/api")).toBe("/habits");
  });
  it("is null outside the base path, including prefix-only look-alikes", () => {
    expect(stripBasePath("/api/habits", "/functions/v1/api")).toBeNull();
    expect(stripBasePath("/apix/habits", "/api")).toBeNull();
  });
  it("maps the base path itself to the root", () => {
    expect(stripBasePath("/api", "/api")).toBe("/");
  });
});

describe("router.match", () => {
  it("keeps /circles/join/preview apart from /circles/join and /circles/:circleId/...", () => {
    const preview = router.match("POST", "/circles/join/preview");
    expect(preview.kind === "match" && preview.route.pattern).toBe("/circles/join/preview");
    const join = router.match("POST", "/circles/join");
    expect(join.kind === "match" && join.route.pattern).toBe("/circles/join");
    const leave = router.match("POST", "/circles/join/leave");
    expect(leave.kind === "match" && leave.route.pattern).toBe("/circles/:circleId/leave");
  });

  it("matches a route and extracts decoded params", () => {
    expect(router.match("PUT", "/seasons/s%201/commitments/c2")).toMatchObject({
      kind: "match",
      params: { seasonId: "s 1", commitmentId: "c2" },
    });
  });

  it("returns the declared route object", () => {
    const m = router.match("POST", "/habits");
    expect(m.kind === "match" && m.route).toEqual(route("POST", "/habits"));
  });

  it("RT-S7: unknown paths are 404", () => {
    expect(router.match("GET", "/circles/abc/nonsense")).toEqual({ kind: "notFound" });
  });

  it("RT-S15: /me is not routed", () => {
    expect(router.match("GET", "/me")).toEqual({ kind: "notFound" });
    expect(router.match("DELETE", "/me")).toEqual({ kind: "notFound" });
  });

  it("RT-S8: wrong method on a known shape is 405 with the sorted Allow set", () => {
    expect(router.match("GET", "/habits")).toEqual({ kind: "methodNotAllowed", allow: ["POST"] });
    expect(router.match("PATCH", "/seasons/s/commitments/c")).toEqual({
      kind: "methodNotAllowed",
      allow: ["DELETE", "PUT"],
    });
  });

  it("empty segments and trailing slashes are 404", () => {
    expect(router.match("POST", "//habits")).toEqual({ kind: "notFound" });
    expect(router.match("POST", "/habits/")).toEqual({ kind: "notFound" });
    expect(router.match("POST", "/")).toEqual({ kind: "notFound" });
    // a param must never bind an empty value
    expect(router.match("PATCH", "/circles/")).toEqual({ kind: "notFound" });
    expect(router.match("GET", "/seasons//standings")).toEqual({ kind: "notFound" });
  });

  it("bad percent-encoding is 404, not a throw", () => {
    expect(router.match("PATCH", "/circles/%E0%A4%A")).toEqual({ kind: "notFound" });
  });
});

describe("createRouter construction", () => {
  it("throws on a duplicated param name", () => {
    expect(() => createRouter([route("GET", "/a/:x/b/:x")])).toThrow(/duplicate param/i);
  });
  it("throws on same-method routes of the same shape", () => {
    expect(() => createRouter([route("GET", "/a/:x"), route("GET", "/a/:y")])).toThrow(
      /same shape/i,
    );
    expect(() => createRouter([route("GET", "/a/:x"), route("GET", "/a/b")])).toThrow(
      /same shape/i,
    );
  });
  it("allows the same shape under different methods", () => {
    expect(() => createRouter([route("GET", "/a/:x"), route("PUT", "/a/:y")])).not.toThrow();
  });
  it("throws on malformed patterns", () => {
    for (const p of ["a/b", "/a/", "//a", "/a/:", "/"]) {
      expect(() => createRouter([route("GET", p)])).toThrow(/pattern/i);
    }
  });
});
