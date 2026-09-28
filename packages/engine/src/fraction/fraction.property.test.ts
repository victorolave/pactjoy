import { assert, bigInt, property, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import type { Fraction } from "./fraction.ts";
import { add, compare, div, frac, mul, sub } from "./fraction.ts";

/** Test-only gcd, independent of the production `gcd` in fraction.ts, used to verify normalization. */
function referenceGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

const nonZeroBigInt = bigInt().filter((n) => n !== 0n);
const anyFraction = tuple(bigInt(), nonZeroBigInt).map(([num, den]) => frac(num, den));
const nonZeroFraction = tuple(nonZeroBigInt, nonZeroBigInt).map(([num, den]) => frac(num, den));

describe("Fraction invariants (property-based, fast-check)", () => {
  it("every fraction frac() produces is normalized: den > 0, gcd(|num|,den) = 1, zero is canonical 0/1", () => {
    assert(
      property(bigInt(), nonZeroBigInt, (num, den) => {
        const f: Fraction = frac(num, den);
        expect(f.den > 0n).toBe(true);
        if (f.num === 0n) {
          expect(f.den).toBe(1n);
        } else {
          expect(referenceGcd(f.num, f.den)).toBe(1n);
        }
      }),
    );
  });

  it("compare is antisymmetric: compare(b,a) is the exact negation of compare(a,b)", () => {
    assert(
      property(anyFraction, anyFraction, (a, b) => {
        expect(compare(b, a)).toBe(-compare(a, b));
      }),
    );
  });

  it("compare is transitive: a<=b and b<=c implies a<=c", () => {
    assert(
      property(anyFraction, anyFraction, anyFraction, (a, b, c) => {
        if (compare(a, b) <= 0 && compare(b, c) <= 0) {
          expect(compare(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("div(mul(a,b), b) recovers a exactly, for any nonzero b", () => {
    assert(
      property(anyFraction, nonZeroFraction, (a, b) => {
        expect(div(mul(a, b), b)).toEqual(a);
      }),
    );
  });

  it("add is commutative: add(a,b) equals add(b,a)", () => {
    assert(
      property(anyFraction, anyFraction, (a, b) => {
        expect(add(a, b)).toEqual(add(b, a));
      }),
    );
  });

  it("add is associative: add(add(a,b),c) equals add(a,add(b,c))", () => {
    assert(
      property(anyFraction, anyFraction, anyFraction, (a, b, c) => {
        expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
      }),
    );
  });

  it("sub(add(a,b), b) recovers a exactly", () => {
    assert(
      property(anyFraction, anyFraction, (a, b) => {
        expect(sub(add(a, b), b)).toEqual(a);
      }),
    );
  });
});
