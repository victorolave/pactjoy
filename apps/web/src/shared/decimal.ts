/**
 * Exact decimals for quantities: a value is a BigInt holding `value x 100`, so two decimal places
 * are exact and nothing ever goes through a float. Strings are the wire format (the API takes
 * decimal strings).
 */

const SCALE = 100n;
const DECIMAL = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** "10" -> 1000n, "10,5" -> 1050n. Null for anything that is not a non-negative decimal of <= 2 places. */
export function toScaled(raw: string): bigint | null {
  const match = DECIMAL.exec(raw.trim());
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * SCALE + fraction;
}

/** The shortest exact string: 1050n -> "10.5", 1000n -> "10", 5n -> "0.05". */
export function fromScaled(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/** `a + delta`, floored at zero (a quantity is never negative). */
export function addScaled(a: bigint, delta: bigint): bigint {
  const sum = a + delta;
  return sum < 0n ? 0n : sum;
}

/** The nearest multiple of `step`; halves round up. */
export function roundToMultiple(value: bigint, step: bigint): bigint {
  return ((value + step / 2n) / step) * step;
}
