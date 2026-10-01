import { ConcurrencyConflict } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable } from "./unavailable.ts";

const coded = (code: string) => Object.assign(new Error("boom"), { code });

describe("isDatabaseUnavailable", () => {
  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ECONNRESET",
    "EPIPE",
    "ECONNABORTED",
    "ENETUNREACH",
    "ENETDOWN",
    "EAI_AGAIN",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "53300",
    "57P01",
    "57P02",
    "57P03",
  ])("is true for code %s", (code) => {
    expect(isDatabaseUnavailable(coded(code))).toBe(true);
  });

  it.each([
    "23505",
    "22P02",
    "40001",
    "40P01",
    "42P01",
    "57014",
    "53200",
    "0A000",
    "X08000",
    "",
    "08P01",
    "08007",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ])("is false for code %s", (code) => {
    expect(isDatabaseUnavailable(coded(code))).toBe(false);
  });

  it("is true for a plain object carrying a connection code", () => {
    expect(isDatabaseUnavailable({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("is false for non-error values and errors without a usable code", () => {
    for (const value of [null, undefined, 0, "08000", new Error("x"), {}, { code: 8000 }])
      expect(isDatabaseUnavailable(value), String(value)).toBe(false);
  });

  it("unwraps a nested cause", () => {
    const wrapped = new Error("outer", { cause: coded("ECONNRESET") });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
    expect(isDatabaseUnavailable(new Error("outer", { cause: coded("23505") }))).toBe(false);
  });

  it("unwraps AggregateError members", () => {
    const agg = new AggregateError([coded("23505"), coded("ECONNREFUSED")], "multi");
    expect(isDatabaseUnavailable(agg)).toBe(true);
    expect(isDatabaseUnavailable(new AggregateError([coded("23505")], "multi"))).toBe(false);
  });

  it("is bounded to depth 3 and survives cycles", () => {
    const deep = (levels: number): unknown => {
      let node: unknown = coded("ECONNREFUSED");
      for (let i = 0; i < levels; i++) node = new Error("w", { cause: node });
      return node;
    };
    expect(isDatabaseUnavailable(deep(3))).toBe(true);
    expect(isDatabaseUnavailable(deep(4))).toBe(false);
    const a: { cause?: unknown } = new Error("a");
    const b: { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(isDatabaseUnavailable(a)).toBe(false);
  });

  it("is false for ConcurrencyConflict", () => {
    expect(isDatabaseUnavailable(new ConcurrencyConflict())).toBe(false);
  });
});
