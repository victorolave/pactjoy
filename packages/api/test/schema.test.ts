import { describe, expect, it } from "vitest";
import {
  array,
  literal,
  nullable,
  number,
  object,
  oneOf,
  optional,
  parse,
  string,
} from "../src/validation/schema.ts";

const habit = object({ name: string, weight: number, note: optional(string) });

describe("object schema", () => {
  it("returns a new object with the known keys only and omits absent optionals", () => {
    const input = { name: "Run", weight: 2 };
    const r = parse(habit, input);
    expect(r).toEqual({ ok: true, value: { name: "Run", weight: 2 } });
    if (r.ok) {
      expect(r.value).not.toBe(input);
      expect("note" in r.value).toBe(false);
    }
  });

  it("keeps present optionals", () => {
    expect(parse(habit, { name: "a", weight: 1, note: "n" })).toEqual({
      ok: true,
      value: { name: "a", weight: 1, note: "n" },
    });
  });

  it("rejects unknown fields, nested too (RV-S8)", () => {
    expect(parse(habit, { name: "a", weight: 1, extra: 1 })).toEqual({
      ok: false,
      issues: [{ path: "extra", problem: "unknownField" }],
    });
    const nested = object({ inner: habit });
    expect(parse(nested, { inner: { name: "a", weight: 1, x: 1 } })).toEqual({
      ok: false,
      issues: [{ path: "inner.x", problem: "unknownField" }],
    });
  });

  it("rejects __proto__ without polluting anything (RV-S9)", () => {
    const body = JSON.parse('{"name":"a","weight":1,"__proto__":{"polluted":true}}');
    expect(parse(habit, body)).toEqual({
      ok: false,
      issues: [{ path: "__proto__", problem: "unknownField" }],
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reports missing required fields and wrong types", () => {
    expect(parse(habit, { weight: "x" })).toEqual({
      ok: false,
      issues: [
        { path: "name", problem: "required" },
        { path: "weight", problem: "type" },
      ],
    });
  });

  it("rejects non-objects at the top level and treats an empty body as {}", () => {
    for (const bad of [null, [], "x", 1, true]) {
      expect(parse(habit, bad)).toEqual({ ok: false, issues: [{ path: "", problem: "type" }] });
    }
    expect(parse(object({}), undefined)).toEqual({ ok: true, value: {} });
    expect(parse(habit, undefined).ok).toBe(false);
  });

  it("orders issues by schema field order, then unknown fields in input order (RV-S26)", () => {
    const r = parse(object({ a: string, b: string }), { z: 1, b: 1, y: 1 });
    expect(r).toEqual({
      ok: false,
      issues: [
        { path: "a", problem: "required" },
        { path: "b", problem: "type" },
        { path: "z", problem: "unknownField" },
        { path: "y", problem: "unknownField" },
      ],
    });
  });

  it("caps the issues at 10", () => {
    const body = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 1]));
    const r = parse(object({}), body);
    expect(!r.ok && r.issues).toHaveLength(10);
  });
});

describe("combinators", () => {
  it("number accepts finite numbers only", () => {
    const s = object({ n: number });
    expect(parse(s, { n: 1.5 }).ok).toBe(true);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      expect(parse(s, { n: bad }).ok).toBe(false);
    }
  });

  it("literal and oneOf", () => {
    const s = object({ d: literal("reach"), u: oneOf(["km", "pages"]) });
    expect(parse(s, { d: "reach", u: "km" }).ok).toBe(true);
    expect(parse(s, { d: "limit", u: "kms" })).toEqual({
      ok: false,
      issues: [
        { path: "d", problem: "enum" },
        { path: "u", problem: "enum" },
      ],
    });
  });

  it("nullable accepts null, still requires presence", () => {
    const s = object({ note: nullable(string) });
    expect(parse(s, { note: null })).toEqual({ ok: true, value: { note: null } });
    expect(parse(s, {}).ok).toBe(false);
  });

  it("array validates elements with indexed paths and a max length", () => {
    const s = object({ days: array(number, 7) });
    expect(parse(s, { days: [1, 2] })).toEqual({ ok: true, value: { days: [1, 2] } });
    expect(parse(s, { days: [1, "x"] })).toEqual({
      ok: false,
      issues: [{ path: "days.1", problem: "type" }],
    });
    expect(parse(s, { days: Array(8).fill(1) })).toEqual({
      ok: false,
      issues: [{ path: "days", problem: "range" }],
    });
    expect(parse(s, { days: "x" }).ok).toBe(false);
  });
});
