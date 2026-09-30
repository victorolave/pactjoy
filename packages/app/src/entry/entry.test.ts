import { frac, fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { normalizeNote, requestFingerprint } from "./entry.ts";

describe("requestFingerprint", () => {
  it("gives the same fingerprint to equal fractions in any form (4/2 and 2/1)", () => {
    const fromFraction = requestFingerprint({ kind: "quantity", value: frac(4n, 2n) }, null);

    expect(fromFraction).toBe(requestFingerprint({ kind: "quantity", value: fromInt(2) }, null));
  });

  it("tells different values, kinds and notes apart", () => {
    const base = requestFingerprint({ kind: "quantity", value: fromInt(2) }, "a");

    expect(requestFingerprint({ kind: "quantity", value: frac(5n, 2n) }, "a")).not.toBe(base);
    expect(requestFingerprint({ kind: "done" }, "a")).not.toBe(
      requestFingerprint({ kind: "missed" }, "a"),
    );
    expect(requestFingerprint({ kind: "quantity", value: fromInt(2) }, "b")).not.toBe(base);
  });

  it("treats an empty note and no note as the same", () => {
    expect(requestFingerprint({ kind: "done" }, "")).toBe(
      requestFingerprint({ kind: "done" }, null),
    );
  });
});

describe("normalizeNote", () => {
  it("turns an empty or missing note into null and keeps any other text as it is", () => {
    expect(normalizeNote("")).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote(" ")).toBe(" ");
    expect(normalizeNote("a")).toBe("a");
  });
});
