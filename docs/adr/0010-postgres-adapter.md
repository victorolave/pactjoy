# ADR-0010: Postgres adapter: postgres.js, portable SQL migrations, non-exposed schema, NO KEY UPDATE guards, real-Postgres tests

- **Status:** Proposed (draft: the spike table is final, the rest is completed in the last slice of the change)
- **Date:** 2026-09-30
- **Deciders:** Victor Olave

## Context

`packages/app` owns the ports (`UnitOfWork`, the repositories) and ships in-memory adapters. The next step is a real adapter, `packages/db`, without letting any vendor leak inward (CLAUDE.md, high decoupling). Supabase exposes every table of the `public` schema through its Data API, so the schema choice is also a security decision.

## Decision

- **Driver:** `postgres` (postgres.js), confined to `packages/db` and wrapped behind an internal `SqlExecutor` seam, so repositories write plain parameterized SQL. No ORM, no `supabase-js`. `prepare: false`, because the production URL is the Supavisor transaction pooler. `packages/db` exports only `createPostgresUnitOfWork` and its option types.
- **Migrations:** plain SQL in `supabase/migrations` (`YYYYMMDDHHMMSS_name.sql`, forward-only). Production applies them with `supabase db push`; the test harness applies the same files in lexical order. No `auth.*`, triggers, functions or procedures (enforced by a scan in the test suite).
- **Schema:** everything lives in schema `pactjoy`, which the Data API does not expose. RLS is enabled on every table with no policies, and all access is revoked from `public`, `anon` and `authenticated`. The service role key is never used; authorization lives in the use cases. Rollback on Supabase is `drop schema pactjoy cascade`.
- **Transactions:** the Unit of Work is `sql.begin` at READ COMMITTED. `guardVersion` is an eager `SELECT version ... FOR NO KEY UPDATE` and never `FOR SHARE`:
  - it conflicts with any concurrent UPDATE or guard of the same row, so guard semantics are unchanged;
  - it does not block the `KEY SHARE` locks that foreign-key checks take, so `recordEntry` inserts are not serialized against season guards;
  - a later save of the same row in the same transaction takes the same lock mode, so there is no lock-upgrade deadlock;
  - consequence: saves must never update key columns (primary key or referenced unique columns).
- **Retry:** at most 2 attempts in total, only for 40P01/40001 raised by Postgres. A version-mismatch `ConcurrencyConflict` is never retried. Rule: `work` has no external side effects (notifiers go after commit or through an outbox), because it may run twice.
- **Expired invite codes:** the `invite_code` UNIQUE constraint also covers expired codes, while the in-memory adapter only rejects active collisions. Reusing an expired code raises `ConcurrencyConflict` and `generateInvite`'s retry handles it. Accepted as astronomically rare.
- **Temporary stub:** the pause table is deferred to change A2 (`app-pause-workflow`). Until then a `PauseRequestReader` stub returns no pauses, so pause-aware scoring sees no pauses in production. Remove the stub when A2 lands.
- **Tests:** real Postgres 17. Testcontainers locally; `TEST_DATABASE_URL` in CI, where the harness creates a fresh database on that server. A missing database fails the run, never skips it.

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
- Until A2, production scoring ignores pauses.

### Neutral

- Client roles have no access to `pactjoy`; all access goes through the `api` function and its use cases.

## References

- [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0009](0009-time-model-in-packages-app.md)
- `supabase/migrations/`, `packages/db/test/`
