import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forDate, inviteCode, uuid } from "../src/validation/formats.ts";
import { object, parse } from "../src/validation/schema.ts";

const ok = (schema: Parameters<typeof parse>[0], input: unknown) => parse(schema, { v: input }).ok;
const uuidS = object({ v: uuid });
const codeS = object({ v: inviteCode });
const dateS = object({ v: forDate });

const CANONICAL = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("uuid", () => {
  it("accepts canonical lowercase of any version (RV-S14)", () => {
    expect(parse(uuidS, { v: CANONICAL })).toEqual({ ok: true, value: { v: CANONICAL } });
    fc.assert(fc.property(fc.uuid(), (id) => ok(uuidS, id.toLowerCase())));
  });

  it("REJECTS uppercase instead of normalizing it (RV-S15 adapted)", () => {
    expect(ok(uuidS, CANONICAL.toUpperCase())).toBe(false);
    expect(ok(uuidS, `${CANONICAL.slice(0, 20)}${CANONICAL.slice(20).toUpperCase()}`)).toBe(false);
  });

  it("rejects malformed shapes, including decoded path tricks", () => {
    const bad = [
      "",
      "x",
      CANONICAL.replaceAll("-", ""),
      `${CANONICAL}\n`,
      ` ${CANONICAL}`,
      `${CANONICAL}/`,
      `x/${CANONICAL}`,
      "x/y",
      "..",
      "a\u0000b",
      `${CANONICAL.slice(0, 35)}\u0000`,
      `${CANONICAL.slice(0, -1)}g`,
      "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5",
    ];
    for (const b of bad) expect(ok(uuidS, b), JSON.stringify(b)).toBe(false);
    expect(ok(uuidS, 5)).toBe(false);
    expect(parse(uuidS, { v: "x" })).toEqual({
      ok: false,
      issues: [{ path: "v", problem: "format" }],
    });
  });

  it("rejects the percent-decoded forms a router can hand over", () => {
    expect(ok(uuidS, decodeURIComponent("x%2Fy"))).toBe(false);
    expect(ok(uuidS, decodeURIComponent("%00"))).toBe(false);
  });

  it("any string that is not 36 chars of [0-9a-f-] is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^[0-9a-f-]{36}$/.test(s)),
        (s) => !ok(uuidS, s),
      ),
    );
  });
});

describe("inviteCode", () => {
  it("accepts the app's format and returns the raw string (RV-S16, S17)", () => {
    expect(parse(codeS, { v: " ab3d7k " })).toEqual({ ok: true, value: { v: " ab3d7k " } });
    expect(ok(codeS, "AB3D7K")).toBe(true);
  });

  it("rejects ambiguous characters, wrong lengths, empty and non-strings (RV-S18, S19)", () => {
    for (const b of ["0B3D7K", "OB3D7K", "1B3D7K", "IB3D7K", "LB3D7K", "AB3D7", "AB3D7KK", ""]) {
      expect(ok(codeS, b), b).toBe(false);
    }
    expect(ok(codeS, 123456)).toBe(false);
    expect(ok(codeS, null)).toBe(false);
  });

  it("rejects anything over 64 UTF-16 units before the app sees it (RV-S20)", () => {
    expect(ok(codeS, `${" ".repeat(60)}AB3D7K`)).toBe(false);
    expect(ok(codeS, `${" ".repeat(10)}AB3D7K`)).toBe(true);
    expect(parse(codeS, { v: "x".repeat(65) })).toEqual({
      ok: false,
      issues: [{ path: "v", problem: "format" }],
    });
  });

  it("rejects lone surrogates and non-alphabet characters", () => {
    expect(ok(codeS, "AB3D7\ud800")).toBe(false);
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 6, maxLength: 6 })
          .filter((s) => /[^2-9A-HJKMNP-Za-hjkmnp-z]/.test(s)),
        (s) => !ok(codeS, s),
      ),
    );
  });
});

describe("forDate", () => {
  it("accepts real calendar dates as LocalDate (RV-S24)", () => {
    expect(parse(dateS, { v: "2026-02-28" })).toEqual({ ok: true, value: { v: "2026-02-28" } });
  });

  it("rejects impossible, malformed and non-string dates with format", () => {
    for (const b of ["2026-02-30", "2026-13-01", "26-01-01", "", "2026-1-1", "tomorrow"]) {
      expect(parse(dateS, { v: b })).toEqual({
        ok: false,
        issues: [{ path: "v", problem: "format" }],
      });
    }
    expect(parse(dateS, { v: 20260101 })).toEqual({
      ok: false,
      issues: [{ path: "v", problem: "type" }],
    });
  });
});
