# ADR-0010: Postgres adapter: postgres.js, portable SQL migrations, non-exposed schema, NO KEY UPDATE guards, real-Postgres tests

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Victor Olave

## Context

`packages/app` owns the ports (`UnitOfWork`, the repositories) and ships in-memory adapters. The next step is a real adapter, `packages/db`, without letting any vendor leak inward (CLAUDE.md, high decoupling). Supabase exposes every table of the `public` schema through its Data API, so the schema choice is also a security decision.

## Decision

- **Driver:** `postgres` (postgres.js), confined to `packages/db` and wrapped behind an internal `SqlExecutor` seam, so repositories write plain parameterized SQL. No ORM, no `supabase-js`. `prepare: false`, because the production URL is the Supavisor transaction pooler. `packages/db` exports only `createPostgresUnitOfWork` and its option types.
- **Migrations:** plain SQL in `supabase/migrations` (`YYYYMMDDHHMMSS_name.sql`, forward-only). Production applies them with `supabase db push`; the test harness applies the same files in lexical order. No `auth.*`, triggers, functions or procedures (enforced by a scan in the test suite).
- **Schema and security model:** everything lives in schema `pactjoy`, which the Supabase Data API does not expose (nothing in `public`). Three layers, each tested from the catalog and by connecting as the roles (`packages/db/test/security.pg.test.ts`):
  - `anon`, `authenticated` and `PUBLIC` have no `USAGE` on the schema (migration 000000);
  - every table has RLS enabled and there are no policies, so a role that somehow got a grant would still see zero rows. A catalog scan fails any future table without RLS;
  - migration 000500 revokes every privilege on all tables and sequences and sets default privileges so later tables are covered too.
  The adapter connects with a dedicated database URL; the Supabase service-role key is never used and never committed (scan in the boundary test). Authorization lives in the use cases. Rollback on Supabase is `drop schema pactjoy cascade`.
- **Transactions:** the Unit of Work is `sql.begin` at READ COMMITTED. `guardVersion` is an eager `SELECT version ... FOR NO KEY UPDATE` and never `FOR SHARE`:
  - it conflicts with any concurrent UPDATE or guard of the same row, so guard semantics are unchanged;
  - it does not block the `KEY SHARE` locks that foreign-key checks take, so `recordEntry` inserts are not serialized against season guards;
  - a later save of the same row in the same transaction takes the same lock mode, so there is no lock-upgrade deadlock;
  - consequence: saves must never update key columns. In Postgres a key column is any column of a primary key or of a non-partial unique index, whether or not anything references it. Updating one takes `FOR UPDATE`, an upgrade from the guard's `NO KEY UPDATE` that can deadlock against a concurrent FK `KEY SHARE` holder;
  - therefore the circle invite lives in a child table, `circle_invites` (`circle_id` primary key and FK to `circles` with RESTRICT, unique `code`, `created_at`, `expires_at`, `created_by`). Regenerating an invite updates that table, and a circle save never updates a key column of `circles`. The migration arrives with the circle repository (B4a), together with a regression test: a circle save with a regenerated invite racing a concurrent season insert must not deadlock.
- **Season children and references:** foreign keys point only at aggregate roots and are all RESTRICT (`circle_members` and `seasons` to `circles`, `entries` to `seasons`); only a season's own children (`season_commitments`, `season_approvals`) cascade. `entries` has no foreign key to commitments or habits, because children are replaced wholesale on save and aggregates reference each other by id. `entries.insert_seq` and `seasons.insert_seq` (identity) give the insertion order the ports promise; `created_at` ties under a fixed clock.
- **Reads:** `read()` runs `repeatable read read only`, so a season and its children load from one snapshot. `guardVersion` is a no-op there, as the port says.
- **Error mapping:** `40P01` and `40001` are retried; a `23505` on a named key constraint (primary keys, `circle_invites` code, the entry idempotency key) becomes `ConcurrencyConflict` and is not retried. Everything else (other constraints, `25006`, `25P02`, `42P01`) is rethrown raw because it is a bug, not a race. Constraints are named explicitly in the migrations because the mapping keys on the names.
- **Codecs:** the driver `types` parse timestamptz into exact `Instant` milliseconds with a strict parser, dates as raw strings and `int8` as `bigint`; `timestamp` without time zone throws. Values are bound as text with explicit casts. The season measure is versioned jsonb, `{ v: 1, ... }`, with fractions as `{ num, den }` decimal-integer strings (a JSON number loses precision beyond 2^53); decoding an unknown `v` or shape throws `MeasureCodecError`. The jsonb parameter is written as `$n::text::jsonb`, because postgres.js would otherwise `JSON.stringify` the already-serialized payload a second time.
- **Ids:** `createUuidV7IdGenerator` in `packages/app` (RFC 9562, `crypto.getRandomValues`, portable). Ids are time-ordered across milliseconds only and nothing orders by id; the 48-bit timestamp would truncate above 2^48 ms, which `Instant` cannot reach.
- **Retry:** at most 2 attempts in total, only for 40P01/40001 raised by Postgres. A version-mismatch `ConcurrencyConflict` is never retried. Rule: `work` has no external side effects (notifiers go after commit or through an outbox), because it may run twice.
- **Expired invite codes:** the unique `code` also covers expired codes, while the in-memory adapter only rejects active collisions, and `generateUniqueInviteCode` only pre-checks active codes. Reusing an expired code therefore reaches `save()` and surfaces `ConcurrencyConflict` to the caller, and the client retries. Accepted as astronomically rare.
- **Roles:** the migrations assume the `anon` and `authenticated` roles exist (Supabase provides them) and do not create them; there is no `DO` block. The test harness bootstraps both as `NOLOGIN` before migrating (tolerating a concurrent run that creates them first).
- **Temporary stub:** the pause table is deferred to change A2 (`app-pause-workflow`). Until then a `PauseRequestReader` stub returns no pauses, so pause-aware scoring sees no pauses in production. Remove the stub when A2 lands.
- **Tests:** real Postgres 17. Testcontainers locally; in CI the `db` job runs a `postgres:17` service container and sets `TEST_DATABASE_URL`, where the harness creates a fresh database on that server (the `ci` job skips `@pactjoy/db`). A missing database fails the run, never skips it. The same adapter-neutral contract suites (`@pactjoy/app/contracts`) run against the in-memory adapters and Postgres.
- **Composition:** `createPostgresUnitOfWork({ url, max?, connectTimeoutSeconds? })` is the only runtime export; connections open lazily and `end()` closes the pool.

### Open items for change C (the `api` function)

- Validate identifier formats at the API boundary: the invite code goes straight to `findByInviteCode`, so a lone surrogate would reach the driver as a bound parameter; the same for ids in request bodies (uuid format) and `clientRequestId`.
- The error-to-HTTP mapping must cover every app error kind, including the newer ones (invalid why, category and note, the custom-label errors, frequency and weekday errors, precision errors, `IdempotencyKeyReused`, `EntryDeleted`, `InvalidClientRequestId`).
- No `Promise.all` inside a transaction (one connection, statements are sequential).
- Verify once against production what could not be tested locally: the hosted Supavisor, TLS and Edge cold starts. Use the pooler (6543, transaction mode) for the function and the direct URL for migrations (`supabase db push`).
- The custom-label length counts UTF-16 units while the note limit counts code points; revisit only if it becomes user-facing.

### Spike results (2026-09-30, local Supabase CLI 2.119.0, edge-runtime 1.77.1 / Deno 2.1.4)

Both URL types ran the same scratch Edge Function, with `prepare: false` and the custom `types` for timestamptz, date and int8.

| Check                                                           | Direct (`db:5432`) | Supavisor transaction pooler (`:6543`) |
| --------------------------------------------------------------- | ------------------ | -------------------------------------- |
| `sql.begin("isolation level read committed")`                   | pass               | pass                                   |
| `SELECT ... FOR NO KEY UPDATE` then version-checked UPDATE      | pass               | pass                                   |
| Two-connection lock wait (second UPDATE blocks until commit)    | pass               | pass                                   |
| FK insert is not blocked by a held `NO KEY UPDATE`              | pass (7 ms)        | pass (7 ms)                            |
| `unsafe(text, params)` with `$n`                                | pass               | pass                                   |
| Custom types: timestamptz to ms, date string, exact int8 BigInt | pass               | pass                                   |
| `set local timezone` inside a transaction                       | pass               | pass                                   |
| `code` and `constraint_name` on 23505; real 40P01 deadlock      | pass               | pass                                   |
| READ ONLY REPEATABLE READ rejects writes with 25006             | pass               | pass                                   |

- Postgres major: **17** (`select version()` = 17.11, `config.toml` `major_version = 17`). The Testcontainers image and CI service stay on `postgres:17`.
- **Verdict: GO.** postgres.js runs in the Edge Runtime; the `jsr:@db/postgres` fallback is not needed.
- Gotcha: in the Edge Runtime a failed connection (DNS, refused, unreachable) is not a catchable rejection. The worker dies with an event-loop error and the gateway answers an empty 503 (21 s for an unreachable IP). The "unreachable database gives a clear error" behavior is therefore tested on Node only.
- Gotcha: Deno does not resolve container hostnames with underscores (`supabase_pooler_<project>`); use the network alias (`pooler`, `db`).
- Not testable locally: the hosted Supavisor (session 5432 vs transaction 6543 on the pooler host), the IPv6-only direct host without the IPv4 add-on, production Edge Runtime cold starts and TLS settings, and the pooler under real concurrency. Verify the production URL once in change C.

## Alternatives considered

### An ORM (Drizzle, Kysely)

- **Pros:** typed queries, migration tooling.
- **Cons:** a second abstraction over the ports, and another vendor to keep out of the domain.
- **Why rejected:** the ports already are the abstraction; plain SQL behind `SqlExecutor` keeps a driver swap to two files.

### `supabase-js` / PostgREST

- **Pros:** no driver, works over HTTP.
- **Cons:** no multi-statement transactions or row locks, which the Unit of Work needs; couples the adapter to Supabase.
- **Why rejected:** cannot implement `guardVersion`.

### SERIALIZABLE instead of guards, or `FOR SHARE` / `FOR UPDATE` guards

- **Pros:** SERIALIZABLE needs no explicit locks.
- **Cons:** SERIALIZABLE causes retry storms and diverges from the in-memory model. `FOR SHARE` deadlocks on lock upgrade. `FOR UPDATE` blocks FK `KEY SHARE`.
- **Why rejected:** `FOR NO KEY UPDATE` gives the same guard semantics without either problem.

### PGlite or the local Supabase stack for tests

- **Pros:** no Docker or lighter.
- **Cons:** PGlite differs from the production server in locking behavior; the local stack is slow and couples tests to Supabase.
- **Why rejected:** the guard and retry semantics need the real server. Testcontainers gives it.

## Consequences

### Positive

- Every vendor stays in `packages/db`; replacing the database means a new adapter that passes the same contract suites.
- Schema changes are reviewable SQL files, applied identically in tests and production.

### Negative

- Tests need Docker (or `TEST_DATABASE_URL`); test files run serially against one database.
- Invite-code uniqueness is global, including expired codes.
- FK checks take `KEY SHARE` on the parent row; `NO KEY UPDATE` guards do not block them, but saves must never update a key column of a guarded root (the invite lives in `circle_invites` for that reason).
- Until A2, production scoring ignores pauses.

### Neutral

- Client roles have no access to `pactjoy`; all access goes through the `api` function and its use cases.

## References

- [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0009](0009-time-model-in-packages-app.md)
- `supabase/migrations/`, `packages/db/test/`
