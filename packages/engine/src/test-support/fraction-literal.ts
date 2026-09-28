import type { Fraction } from "../fraction/fraction.ts";
import { frac } from "../fraction/fraction.ts";

/**
 * Parses an exact fraction string like `"25/12"` or a whole number like
 * `"4"` into a {@link Fraction}. Test-support only — never exported from
 * `index.ts`. Used by acceptance row tables so expected values are written
 * as exact strings (per ADR-0005), never as floats.
 */
const FRACTION_LITERAL = /^-?\d+(\/\d+)?$/;

/** @throws {RangeError} if `s` is not `"-?digits(/digits)?"` — BigInt("") is 0n, not an error, so this can't rely on BigInt to reject a blank part. */
export function fr(s: string): Fraction {
  if (!FRACTION_LITERAL.test(s)) {
    throw new RangeError(`fr: "${s}" is not a valid fraction literal`);
  }
  const [numerator, denominator] = s.split("/") as [string, string | undefined];
  return frac(BigInt(numerator), denominator === undefined ? 1n : BigInt(denominator));
}
