/**
 * Exact rational arithmetic (BigInt numerator/denominator). See ADR-0006.
 *
 * A {@link Fraction} is always normalized: `den > 0n` and
 * `gcd(|num|, den) === 1n`. Zero is always represented as `{ num: 0n, den: 1n }`.
 * No function in this module ever produces or consumes a `number`/`float`
 * for a value that participates in scoring arithmetic.
 */

/**
 * Type-only brand (never assigned, never read, erased at compile time —
 * zero runtime cost). Its only job is to make a hand-written literal like
 * `{ num: 5n, den: 0n }` fail to type-check as {@link Fraction}: the brand
 * key isn't exported, so nothing outside this module can produce a value
 * that has it. The only way to get a `Fraction` is through {@link frac},
 * {@link fromInt} or {@link parseDecimal}. See `fraction.type-test.ts`.
 */
declare const fractionBrand: unique symbol;

export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
  readonly [fractionBrand]: true;
}

const ZERO = { num: 0n, den: 1n } as Fraction;
const ONE = { num: 1n, den: 1n } as Fraction;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Builds a normalized {@link Fraction} from a numerator and denominator.
 * The sign always lands on the numerator, and the pair is reduced by their
 * greatest common divisor.
 *
 * @throws {RangeError} if `den` is `0n`.
 */
export function frac(num: bigint, den = 1n): Fraction {
  if (den === 0n) {
    throw new RangeError("frac: denominator cannot be zero");
  }
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) {
    return ZERO;
  }
  const g = gcd(n, d);
  return { num: n / g, den: d / g } as Fraction;
}

/**
 * Converts a safe integer to a whole-number {@link Fraction}.
 *
 * @throws {RangeError} if `n` is not a safe integer (`Number.isSafeInteger`).
 */
export function fromInt(n: number): Fraction {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`fromInt: ${n} is not a safe integer`);
  }
  return frac(BigInt(n));
}

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.num, a.den * b.den);
}

/**
 * @throws {RangeError} if `b` is zero.
 */
export function div(a: Fraction, b: Fraction): Fraction {
  if (b.num === 0n) {
    throw new RangeError("div: cannot divide by a zero fraction");
  }
  return frac(a.num * b.den, a.den * b.num);
}

/** Returns `-1` if `a < b`, `1` if `a > b`, `0` if `a === b`. */
export function compare(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function eq(a: Fraction, b: Fraction): boolean {
  return compare(a, b) === 0;
}

export function lt(a: Fraction, b: Fraction): boolean {
  return compare(a, b) < 0;
}

export function lte(a: Fraction, b: Fraction): boolean {
  return compare(a, b) <= 0;
}

export function gt(a: Fraction, b: Fraction): boolean {
  return compare(a, b) > 0;
}

export function gte(a: Fraction, b: Fraction): boolean {
  return compare(a, b) >= 0;
}

export function min(a: Fraction, b: Fraction): Fraction {
  return lte(a, b) ? a : b;
}

export function max(a: Fraction, b: Fraction): Fraction {
  return gte(a, b) ? a : b;
}

export function sum(list: readonly Fraction[]): Fraction {
  return list.reduce((total, next) => add(total, next), ZERO);
}

/**
 * Averages a list of fractions.
 *
 * @param emptyThrows When `true` (default), an empty list throws a
 * `RangeError` instead of silently returning zero — callers that need a
 * "no scored opportunities yet" distinction (R6) must pass `false` and
 * handle zero explicitly themselves.
 * @throws {RangeError} if `list` is empty and `emptyThrows` is `true`.
 */
export function mean(list: readonly Fraction[], emptyThrows = true): Fraction {
  if (list.length === 0) {
    if (emptyThrows) {
      throw new RangeError("mean: cannot average an empty list");
    }
    return ZERO;
  }
  return div(sum(list), fromInt(list.length));
}

/** Clamps a fraction into `[0, 1]`. */
export function clamp01(f: Fraction): Fraction {
  if (lt(f, ZERO)) return ZERO;
  if (gt(f, ONE)) return ONE;
  return f;
}

export function isZero(f: Fraction): boolean {
  return f.num === 0n;
}

/** Floor division for BigInts, assuming `divisor > 0n`. */
function floorDiv(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder !== 0n && remainder < 0n ? quotient - 1n : quotient;
}

/**
 * Rounds a fraction to the nearest integer, half-up. D6 (proration) and D10
 * (display) only ever apply this to non-negative quantities (a prorated
 * target, a point total), so they don't actually specify a tie-break for
 * negative values — rounding `.5` toward `+Infinity` in that case is this
 * module's own convention (a single consistent rule, rather than a
 * magnitude-based round-half-away-from-zero). Computed exactly as
 * `floor((2*num + den) / (2*den))` — no float ever enters the computation.
 * The only two call sites in the engine are proration (D6) and display (D10).
 */
export function roundHalfUp(f: Fraction): bigint {
  return floorDiv(2n * f.num + f.den, 2n * f.den);
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Parses a plain decimal string (e.g. `"3.5"`, `"-1.25"`, `"4"`) into an
 * exact {@link Fraction}. Used at the boundary where the app hands the
 * engine a Postgres `numeric` value as text — never a `number`/float.
 *
 * @throws {RangeError} if `s` is not a plain decimal string: exponent
 * notation, `"NaN"`, an empty string, and multiple decimal points are all
 * rejected.
 */
export function parseDecimal(s: string): Fraction {
  if (!DECIMAL_STRING.test(s)) {
    throw new RangeError(`parseDecimal: "${s}" is not a plain decimal string`);
  }
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const dotIndex = unsigned.indexOf(".");
  const integerPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? "" : unsigned.slice(dotIndex + 1);
  const den = 10n ** BigInt(fractionPart.length);
  const num = BigInt(integerPart + fractionPart);
  return frac(negative ? -num : num, den);
}
