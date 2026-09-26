# ADR-0006: Exact rational arithmetic with hand-rolled BigInt fractions

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Victor Olave

## Context

Scores average progress values such as 2/3 and 11/15. Rounding before
summing gives wrong totals (worked-example row F7: 304 ≠ 300; row F8:
240 ≠ 250). Rounding is allowed only at display (D10) and for prorated
targets (D6).

This is not redundant with `CLAUDE.md`'s "no float" rule: this ADR records
*why* a decimal library and fixed-point representation were rejected in
favor of a hand-rolled type, which is a dependency decision under the
project's high-decoupling principle and hard to reverse once every type in
the domain carries `Fraction`.

## Decision

The engine uses a hand-rolled immutable `Fraction { num, den: bigint }`
that is always normalized (`den > 0`, `gcd(|num|, den) = 1`). No float ever
enters a calculation. `roundHalfUp` is exact, computed on the fraction, and
called only from proration (D6) and display (D10).

## Alternatives considered

### JS `number`

- **Pros:** Fast, native, no extra type to maintain.
- **Cons:** 1/3 is inexact in binary floating point and errors accumulate
  across an average of many opportunities.
- **Why rejected:** The scoring engine's own worked examples (F7, F8) show
  that rounding intermediate float values before summing produces the
  wrong total; `number` makes that mistake easy to make by construction.

### Fixed-point BigInt decimal

- **Pros:** Simple, still exact for values with a fixed number of decimal
  places.
- **Cons:** Cannot represent 1/3 or 1/7 exactly — the exact fractions this
  domain regularly produces (see row A4: 25/12 points).
- **Why rejected:** Fixed-point is exact only for terminating decimals;
  this domain's ratios are not guaranteed to terminate.

### A decimal/fraction library (decimal.js, fraction.js)

- **Pros:** Battle-tested, less code to maintain in this repository.
- **Cons:** A runtime dependency in the domain package, which
  `packages/engine` has zero of by design; decimal types are still inexact
  for 1/3; the library's own API would leak into every signature in the
  engine.
- **Why rejected:** Violates the "zero runtime dependencies" constraint on
  `packages/engine` and doesn't solve the exactness problem any better than
  the hand-rolled type.

## Consequences

### Positive

- Exact results by construction, and zero runtime dependencies.
- The invariant (`den > 0`, reduced) is enforced at compile time through a
  branded type (a `unique symbol` key that exists only in the type, never
  at runtime, so it costs nothing at runtime): the only way to produce a
  `Fraction` is through `frac`, `fromInt`, or `parseDecimal` — a hand-written
  literal such as `{ num: 5n, den: 0n }` does not type-check.

### Negative

- Own code to maintain, mitigated by exhaustive unit and property tests.
- `BigInt` is not JSON-serializable, so adapters (`packages/app`) must map
  `Fraction` to a wire format explicitly.

### Neutral

- Performance is irrelevant at this scale (≤6 members × ≤5 commitments ×
  ≤84 days).

## References

- [ADR-0005](0005-worked-examples-as-executable-spec.md) — the worked
  examples (F7, F8) that motivated this decision
- `sdd/scoring-engine/design` — Architecture Decisions table, "Numbers" row
