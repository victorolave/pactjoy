# ADR-0008: Use-case and port conventions in `packages/app`

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Victor Olave

## Context

`packages/app` (CLAUDE.md's hexagonal layer) is where every PactJoy use
case lives: it depends on `@pactjoy/engine` for scoring and on ports
(repositories, clock, id/random generation) that concrete adapters supply
later, in `packages/db` and `supabase/functions`. Before writing the first
use case, this package needs a settled answer to a handful of
cross-cutting questions that are expensive to change once dozens of use
cases exist: how a use case is shaped as code, how it reports failure, how
it groups repository writes into a transaction, how it gets ids/time/
randomness without depending on a runtime directly, and how it is allowed
to depend on `@pactjoy/engine`. `sdd/app-foundation/design` (#4812)
resolved these as architecture decisions D2–D11; this ADR records the
subset that shapes every use case and is expensive to reverse once slices
S2–S9 start writing them. Time (`Clock`/`Instant`/`TimeZone`/
`SeasonDay`) gets its own ADR-0009 once the calendar conversion (S2)
lands; this ADR only fixes `Clock`'s shape and the "adapters only" rule
that ADR-0009 will build on.

## Decision

- **Use-case shape**: a plain async function `(deps, actor, input) =>
  Promise<Result<T, E>>`, one use case per file, grouped by domain
  (`circle/`, `habit/`, `season/`, `commitment/`, `pact/`, `entry/`,
  `score/`). No use-case classes, no dependency-injection container --
  `deps` is a plain object built by the caller (production: the real
  adapters; tests: `createTestApp()`).
- **Errors**: `Result<T, E>` (`packages/app/src/shared/result.ts`) for
  every EXPECTED domain outcome a caller must branch on -- validation,
  not-found, business-rule rejection. A use case throws only for bugs or
  infrastructure failures, the one named case being
  `ConcurrencyConflict` (`shared/errors.ts`) from an aggregate repository's
  optimistic-concurrency `save`.
- **Transaction boundary**: `UnitOfWork<Repositories>.transaction(work)`
  (`ports/unit-of-work.ts`) commits `work`'s side effects when it resolves
  `{ ok: true }`, and rolls them back when it resolves `{ ok: false }` or
  throws; `UnitOfWork.read(work)` runs a read-only query with no rollback
  machinery. `Repositories` is a type parameter, not a fixed interface, so
  this port could be written and tested (`testing/in-memory-unit-of-work.ts`)
  before any concrete repository exists.
- **Aggregates and concurrency**: Circle, Habit, Season and Entry are the
  consistency boundaries (D6); each carries an optimistic `version` field,
  and a repository's `save(aggregate, expectedVersion)` throws
  `ConcurrencyConflict` on a stale write (D5). `PauseRequest` is a
  read-only port, not a written aggregate, in this change.
- **Actor**: `{ readonly userId: UserId }` (`shared/actor.ts`) -- every use
  case receives an already-authenticated `Actor`; authentication itself is
  an adapter concern outside this package.
- **Ids, time and randomness are ports, never globals**: `IdGenerator`,
  `RandomSource` and `Clock` (`ports/id-generator.ts`,
  `ports/random-source.ts`, `time/clock.port.ts`) are the only way a use
  case gets an id, a random choice, or "now" (`Instant`,
  `time/instant.ts`). `Date`, `Intl`, `Math`, `Temporal` and `crypto` are
  banned globals (Biome `style.noRestrictedGlobals`,
  `packages/app/biome.json`) everywhere in `packages/app` except
  `src/adapters/`, the one folder allowed to touch them, mirroring
  `packages/engine`'s own `noRestrictedGlobals` override for the same five
  globals (see that package's `biome.json`). Deterministic in-memory
  adapters for all three ports ship under the separate `./testing`
  subpath export (`src/testing/`), never under `src/index.ts`.
- **Dependency on `@pactjoy/engine`**: `packages/app` depends on
  `@pactjoy/engine` via `workspace:*` and may import only its published
  root (`@pactjoy/engine`, i.e. `packages/engine/src/index.ts`). Biome's
  `style.noRestrictedImports` (`patterns: [{ group:
  ["@pactjoy/engine/**"] }]`) blocks any deeper import
  (e.g. `@pactjoy/engine/scoring/member-score.ts`) at lint time, enforcing
  CLAUDE.md's high-decoupling rule that only a package's own public
  surface is a stable contract.
- **No Node/Deno/vendor imports**: Biome's `correctness.noNodejsModules`
  bans `node:`-prefixed imports, and `style.noRestrictedImports` bans
  `npm:`/`jsr:`-prefixed ones (Deno-specific), keeping `packages/app`
  standard TypeScript/ESM per CLAUDE.md's architecture rules. ADR-0007's
  `useImportExtensions` rule applies here too (inherited from the root
  `biome.json`, and re-declared explicitly in `packages/app/biome.json`
  for a reader who only opens this package's config).

## Alternatives considered

### Use-case classes with a DI container (Nest-style)

- **Pros:** Familiar to anyone coming from NestJS; a container can
  auto-wire dependencies and make swapping an implementation a one-line
  binding change.
- **Cons:** A DI container is itself a dependency that would need its own
  port if `packages/app` is to stay swappable per CLAUDE.md's guiding
  principle; classes add constructor boilerplate and a `this` binding
  surface that plain functions don't have; CLAUDE.md's stack decision
  already ruled out NestJS itself for cost reasons, and importing its DI
  conventions without the framework is an odd middle ground.
- **Why rejected:** Plain functions `(deps, actor, input)` give the exact
  same swappability (call the function with different `deps`) with zero
  extra dependency and zero container to reason about.

### Throw for every failure, expected or not

- **Pros:** Less code at every call site -- no `if (!result.ok) return
  result` propagation; a single `try/catch` at the HTTP adapter boundary
  (future change C) could convert any thrown error to a response.
- **Cons:** Collapses "the caller must handle this" (e.g. `SeasonNotFound`)
  and "this should never happen" (a repository failing to write) into the
  same control-flow mechanism, which is exactly the distinction D3 needs
  to keep straight; TypeScript's `throw` carries no static type, so every
  caller of a throwing function has to consult its documentation (or
  source) to know which errors to expect, instead of the compiler forcing
  a `Result<T, E>` branch to be handled.
- **Why rejected:** `Result` for expected outcomes keeps the compiler in
  the loop on every domain error a caller must react to, while still
  allowing `throw` for the genuinely exceptional (infra/bug) case.

### One repository per database table

- **Pros:** Maps directly onto a future Postgres schema; smaller, more
  focused repository interfaces.
- **Cons:** Splits a single consistency boundary (e.g. a Season with its
  Commitments and PactApprovals) across several repositories with no
  natural place to enforce "these writes commit together"; the proposal's
  original `InviteCode`/`Commitment`/`PactApproval` repositories were
  folded into their owning aggregate for exactly this reason (D6).
- **Why rejected:** A repository per aggregate root (Circle, Habit,
  Season, Entry) keeps each `UnitOfWork.transaction` call aligned with an
  actual consistency boundary; a future Postgres adapter can still use
  several tables per aggregate internally.

### A `Result`/error library (e.g. `neverthrow`)

- **Pros:** Ships combinators (`map`, `andThen`, `match`, ...) that reduce
  the `if (!r.ok) return r` boilerplate this ADR's Negative consequence
  names.
- **Cons:** A third-party dependency for a two-field discriminated union
  that TypeScript already expresses natively; every consumer of
  `@pactjoy/app` (the future `api` Edge Function, tests, this package
  itself) would need to depend on it too, or convert at the boundary
  anyway.
- **Why rejected:** `Result<T, E>` is 8 lines in `shared/result.ts`
  (`type`, `ok`, `err`); combinators can be added later, inside that same
  file, without depending on a vendor package -- and CLAUDE.md's
  high-decoupling rule specifically asks "what would it take to replace
  this?" before adding a dependency here.

## Consequences

### Positive

- Every use case has the exact same call shape and the exact same failure
  contract, so a new one is a known quantity to write and to review.
- Swapping an adapter (a real Postgres `UnitOfWork` for the in-memory one,
  a `crypto`-backed `IdGenerator` for the sequential test one) never
  touches a use case's code, only the `deps` object the caller builds --
  proven now by `testing/app-harness.ts`'s `createTestApp()`, which
  composes only in-memory adapters and nothing production-specific.
- The `@pactjoy/engine`-root-only import rule and the `Date`/`Intl`/
  `Math`/`Temporal`/`crypto`-outside-adapters rule are enforced by Biome,
  not by convention or code review discipline -- a regression fails lint/CI
  immediately (verified in this slice with a temporary violating file: all
  six restrictions fired, and the `src/adapters/` override correctly let
  `Date.now()` through there and nowhere else).

### Negative

- `Result` propagation needs an explicit `if (!result.ok) return result`
  (or an equivalent guard) at every step of a use case that calls another
  fallible operation -- more visible boilerplate than an implicit
  `throw`/`catch` chain, accepted as the cost of the compiler enforcing
  error handling.
- `UnitOfWork<Repositories>` being generic over `Repositories` (no
  concrete repository exists yet in this skeleton slice) means its real
  shape, and `createTestApp()`'s wiring of a real `UnitOfWork`, is only
  proven once the first aggregate (Circle, slice S3) defines its
  repository and in-memory adapter -- open item carried into that slice's
  apply-progress.

### Neutral

- This ADR fixes `Clock`'s interface (`now(): Instant`) but not the
  `Instant → SeasonDay` conversion; that pure-integer calendar math and
  the `TimeZone` port are ADR-0009's decision, landing with slice S2.
- The `ConcurrencyConflict` exception type exists in this skeleton slice
  with no aggregate repository yet throwing it; it is exercised for real
  once Circle's repository (S3) implements `save`.

## References

- `sdd/app-foundation/design` (#4812) -- Architecture Decisions D2--D11;
  exact `Result`/`UnitOfWork`/port/aggregate interfaces this ADR describes
- `sdd/app-foundation/tasks` (#4825) -- slice S1 task list and file layout
- ADR-0007 -- `.ts` import-extension rule this package inherits and
  re-declares
- Root [`CLAUDE.md`](../../CLAUDE.md) -- "Guiding principle: high
  decoupling"; hexagonal architecture section
- `packages/app/biome.json` -- the enforced lint rules this ADR documents
  the reasoning for
