import type { Fraction } from "@pactjoy/engine";

const SCALE = 100n;

/**
 * Renders an exact {@link Fraction} as a decimal string with at most 2
 * decimals and no trailing zeros ("30", "7.5", "0.05"). Commitment thresholds
 * come from inputs of at most 2 decimals (A12), so they always have this
 * exact form; anything else is a bug and throws instead of being rounded
 * (the app never rounds a `Fraction` itself, D10).
 */
export function toDecimalString(value: Fraction): string {
  if (value.num < 0n) {
    throw new RangeError("toDecimalString: negative values are not supported");
  }
  const scaled = value.num * SCALE;
  if (scaled % value.den !== 0n) {
    throw new RangeError("toDecimalString: value has no exact 2-decimal form");
  }
  const hundredths = scaled / value.den;
  const whole = hundredths / SCALE;
  const cents = (hundredths % SCALE).toString().padStart(2, "0");
  return cents === "00" ? `${whole}` : `${whole}.${cents.replace(/0$/, "")}`;
}
