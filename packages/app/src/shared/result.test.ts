import { describe, expect, it } from "vitest";
import { err, ok } from "./result.ts";

describe("ok", () => {
  it("builds a success Result carrying the given value", () => {
    const result = ok(42);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("preserves object identity of the value it wraps", () => {
    const value = { circleId: "circle-1" };

    const result = ok(value);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(value);
    }
  });
});

describe("err", () => {
  it("builds a failure Result carrying the given error", () => {
    const result = err({ kind: "NotFound" });

    expect(result).toEqual({ ok: false, error: { kind: "NotFound" } });
  });

  it("narrows to the error branch when ok is false", () => {
    const result = err<{ kind: "Invalid"; reason: string }>({
      kind: "Invalid",
      reason: "empty name",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("empty name");
    }
  });
});
