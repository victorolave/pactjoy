# ADR-0009: Time model in `packages/app`

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Victor Olave

## Context

`packages/engine` deliberately receives only resolved integer `SeasonDay`
values (ADR-0004) -- it never touches a real instant or a timezone.
Something has to bridge the gap between "a member tapped a button right
now" and "opportunity N of the season", and CLAUDE.md's high-decoupling
rule says that bridge cannot be Postgres or the Edge Function: it is
`packages/app`'s job. `sdd/app-foundation/spec/season-clock` (#4815)
specifies the exact behavior this conversion must have (SC-1..SC-7,
SC-5b) -- a fixed IANA timezone per season, civil-calendar-date
boundaries (not elapsed hours), determinism across runtimes, and reuse of
the engine's own grace-period boundary. ADR-0008 already fixed `Clock`'s
shape (`now(): Instant`) and the "`Date`/`Intl`/`Math`/`Temporal`/
`crypto` only in `src/adapters/`" rule; this ADR is the one D7 deferred to
it: how an `Instant` actually becomes a `SeasonDay`.

## Decision

- **`Instant`** (`time/instant.ts`, from ADR-0008/S1) is epoch
  milliseconds, branded, non-negative. The only production source is
  `Clock.now()`.
- **`LocalDate`** (`time/local-date.ts`) is a branded `"YYYY-MM-DD"`
  civil-calendar-date string, restricted to `1970-01-01` onward (every
  date this app ever produces is "today" or later per A6 -- seasons start
  within 30 days of creation). Its validating constructor checks both
  format and that the date is real (rejects `2026-04-31`, rejects
  `2026-02-29` on a non-leap year).
- **`epochDay`/`localDateOfEpochDay`** (also `local-date.ts`) are a pure
  integer conversion pair between a `LocalDate` and "days since
  1970-01-01", via the proleptic Gregorian `days_from_civil`/
  `civil_from_days` algorithm (Hinnant) -- no `Date`, no `Intl`, no
  floating-point division, only integer subtraction/modulo (the same
  exact-division trick `packages/engine`'s own `weekOf` already uses).
  Every other date computation in this package is built on this pair.
- **`TimeZone`** (`time/time-zone.port.ts`) is the port:
  `localDateAt(at: Instant, zone: TimeZoneId): LocalDate` and
  `isValidZone(zone: string): boolean`. This is the only place a real
  instant is resolved to a civil date -- it is the sole timezone-sensitive
  step in the whole conversion.
- **`toSeasonDay`/`localDateOfSeasonDay`** (`time/season-calendar.ts`) are
  pure integer functions with no zone parameter at all: `SeasonDay =
  epochDay(date) − epochDay(seasonStart)` (SC-1), returning
  `{ kind: "beforeStart" }` when negative or `{ kind: "day", day }`
  otherwise. Having no zone input at all is what makes SC-5b
  (determinism) and SC-6 (only the season's own timezone matters, never a
  member's) true by construction, not by convention.
- **`src/adapters/intl-time-zone.ts`** and **`src/adapters/
  system-clock.ts`** are the real, `Intl`/`Date`-backed implementations,
  confined to `src/adapters/` per ADR-0008's lint-enforced rule.
  `createIntlTimeZone` uses `Intl.DateTimeFormat(...).formatToParts`
  (never string-parsing a formatted date) so ICU resolves DST
  transitions, skipped and repeated local hours correctly -- verified
  empirically against real tz-database transition instants for
  Europe/Madrid (spring-forward SC-3, fall-back SC-4) and
  America/Santiago (a transition that skips local midnight entirely),
  plus Bogotá (no DST) and Kiritimati (fixed UTC+14) as non-transition
  edge cases (`adapters/intl-time-zone.test.ts`).
  `Intl.DateTimeFormat`'s constructor already throws `RangeError` for an
  invalid IANA zone, so `isValidZone` catches that rather than
  reimplementing validation.
- **Grace deadline reuse**: `packages/engine` did not yet export
  `graceDeadline` (`entry/grace-period.ts`) publicly. This ADR adds the
  one-line export to `packages/engine/src/index.ts` (and its pinned
  `index.test.ts` runtime-export list) rather than let `packages/app`
  duplicate `GRACE_DAYS` -- SC-5/SC-7 (the grace deadline is "the day
  after the period's own last day") are the engine's own rule, applied in
  `SeasonDay` terms with no separate app-side implementation.

## Alternatives considered

### `Temporal` (the stage-3 proposal, via a polyfill)

- **Pros:** A real calendar-date/instant type with built-in timezone
  arithmetic would remove the need to hand-roll `epochDay`.
- **Cons:** Not in `ES2022` (this monorepo's `tsconfig.base.json` `lib`),
  so it would need a runtime polyfill dependency across every environment
  (Vitest, Deno, Node, and eventually a browser) -- exactly the kind of
  vendor surface CLAUDE.md's high-decoupling rule asks to avoid unless
  swapping it is genuinely costly to avoid; ADR-0008 already banned it as
  a global outside `src/adapters/` for the same reason `Date`/`Intl` are
  banned.
- **Why rejected:** `Intl.DateTimeFormat.formatToParts` alone, confined to
  one adapter file, does everything this app needs (resolve an instant to
  a civil date in an IANA zone); a hand-rolled, dependency-free
  `epochDay` pair covers the rest.

### Resolve timezones anywhere, not just `src/adapters/`

- **Pros:** Fewer indirection layers -- a use case could call
  `Intl.DateTimeFormat` directly instead of going through a `TimeZone`
  port.
- **Cons:** Breaks the swappability CLAUDE.md asks for (a future Deno
  Edge Function or a different JS engine could resolve IANA zones
  differently) and makes every use case untestable without a real
  timezone database; ADR-0008 already settled this for `Date`/`Intl` in
  general.
- **Why rejected:** One port (`TimeZone`), one production adapter
  (`intl-time-zone.ts`), one deterministic test double
  (`testing/fixed-time-zone.ts`) -- the same pattern ADR-0008 established
  for `Clock`.

### `SeasonDay` only -- no `LocalDate` type, do the epoch-day math inline

- **Pros:** One fewer type in the public API.
- **Cons:** Contradicts `sdd/app-foundation/design`'s package layout
  (P2-3, already fixed in `sdd/app-foundation/design` #4812), and loses a
  reusable, independently testable civil-date type that later slices need
  on its own (e.g. a season's `nominalStart`/`actualStart` fields are
  `LocalDate`, not `SeasonDay` -- they exist before any season start is
  chosen as day 0).
- **Why rejected:** `LocalDate` is the natural intermediate value every
  later slice (`create-season`, `close-pact`) already needs to store and
  compare, independent of any one season's own day-0 offset.

## Consequences

### Positive

- `toSeasonDay`/`localDateOfSeasonDay` have zero `Date`/`Intl` dependency
  and no zone parameter, so they are trivially unit-testable and
  provably deterministic (SC-5b) without any adapter or fake in the loop.
- The DST/edge-case coverage lives in exactly one file
  (`adapters/intl-time-zone.test.ts`), fixture rows generated against
  Node's own tz database rather than hand-computed, so it stays accurate
  as the tz database updates.
- Later slices (S7's `entry-window.ts`) reuse `graceDeadline` from the
  engine directly instead of re-deriving "grace ends the day after" --
  one rule, one place, per CLAUDE.md ("Entries are the source of truth").

### Negative

- `epochDay`/`localDateOfEpochDay`'s Hinnant-algorithm implementation is
  the least self-evidently-correct code in this slice (integer-only
  proleptic Gregorian calendar math); its test suite cross-checks every
  fixture against `Date.UTC`-derived ground truth to compensate, but a
  reviewer still has to trust the algorithm's shape, not just read it
  top-to-bottom.
- `LocalDate` rejects any date before 1970-01-01 -- correct for this
  app's actual domain (A6: seasons start within 30 days of "today"), but
  a future feature needing an earlier date (unlikely) would need to lift
  this constructor's guard, not just call it.

### Neutral

- Reverse conversion beyond `localDateOfSeasonDay` (e.g. turning an
  `Instant` back into a human-readable local time-of-day string for a
  notification) is deferred to whichever future change first needs it
  (`packages/app`'s design doc flags this under change D, jobs/push).

## References

- `sdd/app-foundation/spec/season-clock` (#4815) -- SC-1..SC-7, SC-5b;
  this ADR's Decision section is organized around satisfying each one
- `sdd/app-foundation/design` (#4812) -- D7 (time), D8 (`Intl`/`Date`
  location), package layout (`time/`, `adapters/`)
- `sdd/app-foundation/tasks` (#4825) -- slice S2 task list
- ADR-0004 -- the engine receives only resolved calendar days; this ADR is
  the app-side half of that boundary
- ADR-0008 -- `Clock`'s shape and the `src/adapters/`-only rule this ADR
  extends to `TimeZone`
- `packages/engine/src/entry/grace-period.ts` -- `graceDeadline`, newly
  exported from `packages/engine/src/index.ts` by this slice
