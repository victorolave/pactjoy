import { describe, expect, it } from "vitest";
import { fr } from "./fraction-literal.ts";

describe("fr", () => {
  it('parses "25/12" to the exact Fraction 25/12', () => {
    expect(fr("25/12")).toEqual({ num: 25n, den: 12n });
  });

  it('parses a whole number literal "4" to the exact Fraction 4/1', () => {
    expect(fr("4")).toEqual({ num: 4n, den: 1n });
  });

  it('reduces "2/4" to the exact Fraction 1/2', () => {
    expect(fr("2/4")).toEqual({ num: 1n, den: 2n });
  });

  it("throws RangeError for an empty string", () => {
    expect(() => fr("")).toThrow(RangeError);
  });
});
