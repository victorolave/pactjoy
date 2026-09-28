/**
 * Compile-time-only check (not a vitest file — see the `-test.ts` vs
 * `.test.ts` naming; `tsc --noEmit` type-checks this, vitest never runs it).
 *
 * `Fraction` must be constructible only through `frac`, `fromInt` or
 * `parseDecimal`, never through a hand-written literal — otherwise nothing
 * stops an invalid, unnormalized value like `{ num: 5n, den: 0n }` from
 * type-checking as a valid `Fraction`.
 */
import type { Fraction } from "./fraction.ts";

// @ts-expect-error — Fraction is a branded type; only frac/fromInt/parseDecimal can produce one.
const invalidFraction: Fraction = { num: 5n, den: 0n };

void invalidFraction;
