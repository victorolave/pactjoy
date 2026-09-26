# ADR-0004: Scoring engine works on resolved calendar days

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Victor Olave

## Context

Seasons run in one timezone. Weeks count from the season start day, and the
grace period runs "until end of next day". A pure, deterministic engine must
not depend on wall-clock time, DST or host timezone data. Every scoring rule
is stated in calendar days.

## Decision

`packages/engine` receives only resolved calendar days: `SeasonDay`, an
integer index from the season start, plus the season's `startWeekday`.
"Today" is a plain `SeasonDay` argument. `packages/app` owns the `Clock` port
and converts real instants to season days in the season timezone. `Date`,
`Intl` and `Temporal` are forbidden in the engine and enforced by lint.

## Alternatives considered

### `Date`

- **Pros:** Ubiquitous, no conversion code needed at the call site.
- **Cons:** Host-timezone and DST dependent; a platform type leaking into
  the domain.
- **Why rejected:** A pure engine must be deterministic regardless of the
  host's timezone or clock; `Date` breaks that guarantee.

### `Temporal`

- **Pros:** Correct calendar/timezone model, purpose-built to replace
  `Date`.
- **Cons:** Not in the ES2022 lib, runtime support is uneven across
  Node/Deno/Safari, and it would couple the domain to a runtime feature.
- **Why rejected:** Same category problem as `Date` — it is still a
  platform/runtime type, just a better one.

### ISO `YYYY-MM-DD` strings

- **Pros:** Human-readable, easy to log and serialize.
- **Cons:** Needs date parsing and weekday math inside the engine to do
  anything useful with them.
- **Why rejected:** Pushes calendar arithmetic into the domain instead of
  keeping the domain on plain integers.

### Clock port inside the engine

- **Pros:** Explicit, testable via injection, a common hexagonal pattern.
- **Cons:** Pure functions only need a value, not a port; a port implies
  something to inject at call time for no payoff here.
- **Why rejected:** `today` is just an argument to a pure function — adding
  a port is indirection with no benefit.

## Consequences

### Positive

- Deterministic tests: no DST or off-by-one class of bugs in the domain.
- Trivial serialization: `SeasonDay` is a plain integer.

### Negative

- `packages/app` must implement and test timezone-to-day conversion; a
  mistake there shifts every day.

### Neutral

- Replacing the runtime or client does not touch the engine.

## References

- [`CLAUDE.md`](../../CLAUDE.md) — Architecture section
- `sdd/scoring-engine/design` — Architecture Decisions table, "Days" row
