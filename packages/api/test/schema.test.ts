import { describe, expect, it } from "vitest";
import {
  array,
  integer,
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

  it("reports missing required fields and wrong types (RV-S11)", () => {
    expect(parse(habit, { weight: "x" })).toEqual({
      ok: false,
      issues: [
        { path: "name", problem: "required" },
        { path: "weight", problem: "type" },
      ],
    });
  });

  it("rejects non-objects at the top level", () => {
    for (const bad of [null, [], "x", 1, true]) {
      expect(parse(habit, bad)).toEqual({ ok: false, issues: [{ path: "", problem: "type" }] });
    }
  });

  it("an undefined body is a required issue at the root unless emptyBody is opted in", () => {
    const required = { ok: false, issues: [{ path: "", problem: "required" }] };
    expect(parse(object({}), undefined)).toEqual(required);
    expect(parse(habit, undefined)).toEqual(required);
    expect(parse(object({}), undefined, { emptyBody: "object" })).toEqual({ ok: true, value: {} });
    expect(parse(object({ note: optional(string) }), undefined, { emptyBody: "object" })).toEqual({
      ok: true,
      value: {},
    });
    // opt-in still validates: required fields are reported against the implied {}
    expect(parse(habit, undefined, { emptyBody: "object" })).toEqual({
      ok: false,
      issues: [
        { path: "name", problem: "required" },
        { path: "weight", problem: "required" },
      ],
    });
  });

  it("rejects a nested __proto__ in an object and in an array element", () => {
    const nested = JSON.parse('{"inner":{"name":"a","weight":1,"__proto__":{"x":1}}}');
    expect(parse(object({ inner: habit }), nested)).toEqual({
      ok: false,
      issues: [{ path: "inner.__proto__", problem: "unknownField" }],
    });
    const list = JSON.parse('{"items":[{"name":"a","weight":1,"__proto__":{"x":1}}]}');
    expect(parse(object({ items: array(habit, 3) }), list)).toEqual({
      ok: false,
      issues: [{ path: "items.0.__proto__", problem: "unknownField" }],
    });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
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

  it("nullable(optional(x)) keeps the field optional and accepts null", () => {
    const s = object({ note: nullable(optional(string)) });
    expect(parse(s, {})).toEqual({ ok: true, value: {} });
    expect(parse(s, { note: null })).toEqual({ ok: true, value: { note: null } });
    expect(parse(s, { note: "n" })).toEqual({ ok: true, value: { note: "n" } });
    expect(parse(s, { note: 1 }).ok).toBe(false);
  });

  it("array rejects sparse holes as invalid elements", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point
    const holey = [1, , 3];
    expect(parse(object({ d: array(number, 5) }), { d: holey })).toEqual({
      ok: false,
      issues: [{ path: "d.1", problem: "type" }],
    });
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

describe("integer({min})", () => {
  const s = object({ n: integer({ min: 0 }) });

  it("accepts safe integers at or above min", () => {
    for (const ok of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
      expect(parse(s, { n: ok })).toEqual({ ok: true, value: { n: ok } });
    }
  });

  it("rejects non-integers and non-numbers as type", () => {
    for (const bad of [1.5, "1", null, true, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(parse(s, { n: bad })).toEqual({ ok: false, issues: [{ path: "n", problem: "type" }] });
    }
  });

  it("rejects integers below min as range", () => {
    expect(parse(s, { n: -1 })).toEqual({ ok: false, issues: [{ path: "n", problem: "range" }] });
    expect(parse(object({ n: integer({ min: 5 }) }), { n: 4 }).ok).toBe(false);
  });

  it("is required unless wrapped in optional", () => {
    expect(parse(s, {})).toEqual({ ok: false, issues: [{ path: "n", problem: "required" }] });
  });
});
