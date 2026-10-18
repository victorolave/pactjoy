# ADR-0010: Postgres adapter: postgres.js, portable SQL migrations, non-exposed schema, NO KEY UPDATE guards, real-Postgres tests

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Victor Olave

## Context

`packages/app` owns the ports (`UnitOfWork`, the repositories) and ships in-memory adapters. The next step is a real adapter, `packages/db`, without letting any vendor leak inward (CLAUDE.md, high decoupling). Supabase exposes every table of the `public` schema through its Data API, so the schema choice is also a security decision.

## Decision

- **Driver:** `postgres` (postgres.js), confined to `packages/db` and wrapped behind an internal `SqlExecutor` seam, so repositories write plain parameterized SQL. No ORM, no `supabase-js`. `prepare: false`, because the production URL is the Supavisor transaction pooler. `packages/db` exports only `createPostgresUnitOfWork` and its option types.
- **Migrations:** plain SQL in `supabase/migrations` (`YYYYMMDDHHMMSS_name.sql`, forward-only). Production applies them with `supabase db push`; the test harness applies the same files in lexical order. No `auth.*`, triggers, functions or procedures (enforced by a scan in the test suite).
- **Schema and security model:** everything lives in schema `pactjoy` and nothing in `public`. Keeping `pactjoy` out of the Supabase Data API exposed schemas is a MANUAL hosted setting (see the operational checklist); no file in the repository configures it (no `config.toml`). The protection that lives in the repository is the schema `USAGE` revoke plus RLS with no policies. Each layer is tested from the catalog and by connecting as the roles (`packages/db/test/security.pg.test.ts`):
  - `anon`, `authenticated` and `PUBLIC` have no `USAGE` on the schema (migration 000000);
  - every table has RLS enabled and there are no policies, so a role that somehow got a grant would still see zero rows. A catalog scan fails any future table without RLS. The adapter's connection role owns the schema and its tables, so RLS does not protect against the adapter itself: authorization lives in the use cases;
  - migration 000500 revokes every privilege on all tables and sequences and sets default privileges so later tables are covered too. Convention: Supabase grants new objects to `anon` and `authenticated` through a GLOBAL default ACL of the migrating role, and an in-schema `alter default privileges ... revoke` does not cancel it (verified on PG17). The migration therefore carries both a global and an in-schema revoke, and the harness simulates both grants before migrating, so deleting 000500 or its global revoke fails the tests.
  The adapter connects with a dedicated database URL; the Supabase service-role key is never used and never committed (scan in the boundary test). Rollback on Supabase is `drop schema pactjoy cascade`.
- **Transactions:** the Unit of Work is `sql.begin` at READ COMMITTED. `guardVersion` is an eager `SELECT version ... FOR NO KEY UPDATE` and never `FOR SHARE`:
  - it conflicts with any concurrent UPDATE or guard of the same row, so guard semantics are unchanged;
  - it does not block the `KEY SHARE` locks that foreign-key checks take, so `recordEntry` inserts are not serialized against season guards;
  - a later save of the same row in the same transaction takes the same lock mode, so there is no lock-upgrade deadlock;
  - consequence: saves must never update key columns. In Postgres a key column is any column of a primary key or of a non-partial unique index, whether or not anything references it. Updating one takes `FOR UPDATE`, an upgrade from the guard's `NO KEY UPDATE` that can deadlock against a concurrent FK `KEY SHARE` holder;
  - therefore the circle invite lives in a child table, `circle_invites` (`circle_id` primary key and FK to `circles` with RESTRICT, unique `code`, `created_at`, `expires_at`, `created_by`). Regenerating an invite updates that table, and a circle save never updates a key column of `circles`. The migration arrives with the circle repository (B4a), together with a regression test: a circle save with a regenerated invite racing a concurrent season insert must not deadlock.
- **Season children and references:** foreign keys point only at aggregate roots and are all RESTRICT (`circle_members` and `seasons` to `circles`, `entries` to `seasons`); only a season's own children (`season_commitments`, `season_approvals`) cascade. `entries` has no foreign key to commitments or habits, because children are replaced wholesale on save and aggregates reference each other by id. `entries.insert_seq` and `seasons.insert_seq` (identity) give the insertion order the ports promise; `created_at` ties under a fixed clock.
- **Reads:** `read()` runs `repeatable read read only`, so a season and its children load from one snapshot. `guardVersion` is a no-op there, as the port says.
- **Error mapping:** `40P01` and `40001` are retried; a `23505` on a named key constraint (primary keys, `circle_invites` code, the entry idempotency key, the one-active-circle-per-user index) becomes `ConcurrencyConflict` and is not retried. After the retries are exhausted, `40P01` and `40001` also map to `ConcurrencyConflict`. A `23505` without a constraint name is rethrown raw. Everything else (other constraints, `25006`, `25P02`, `42P01`) is rethrown raw because it is a bug, not a race. Constraints are named explicitly in the migrations because the mapping keys on the names.
- **Codecs:** the driver `types` parse timestamptz into exact `Instant` milliseconds with a strict parser, dates as raw strings and `int8` as `bigint`; `timestamp` without time zone throws. Values are bound as text with explicit casts. The season measure is versioned jsonb, `{ v: 1, ... }`, with fractions as `{ num, den }` decimal-integer strings (a JSON number loses precision beyond 2^53); decoding an unknown `v` or shape throws `MeasureCodecError`. The jsonb parameter is written as `$n::text::jsonb`, because postgres.js would otherwise `JSON.stringify` the already-serialized payload a second time.
- **Ids:** `createUuidV7IdGenerator` in `packages/app` (RFC 9562, `crypto.getRandomValues`, portable). Ids are time-ordered across milliseconds only and nothing orders by id; the 48-bit timestamp would truncate above 2^48 ms, which `Instant` cannot reach.
- **Retry:** at most 2 attempts in total, only for 40P01/40001 raised by Postgres. A version-mismatch `ConcurrencyConflict` is never retried. Rule: `work` has no external side effects (notifiers go after commit or through an outbox), because it may run twice.
- **Expired invite codes:** the unique `code` also covers expired codes, while the in-memory adapter only rejects active collisions, and `generateUniqueInviteCode` only pre-checks active codes. Reusing an expired code therefore reaches `save()` and surfaces `ConcurrencyConflict` to the caller, and the client retries. Accepted as astronomically rare.
- **Roles:** the migrations assume the `anon` and `authenticated` roles exist (Supabase provides them) and do not create them; there is no `DO` block. The test harness bootstraps both as `NOLOGIN` before migrating (tolerating a concurrent run that creates them first).
- **Pause tables (change `pause-workflow`, ADR-0013):** `pause_requests`, `pause_request_commitments` and `pause_responses` replace the earlier `PauseRequestReader` stub, which is removed. Same conventions as Season: a root plus children replaced wholesale on save, a version-checked UPDATE of the root, children cascading from it, no foreign key from a child to a Commitment, RLS on with no policies, and no triggers or SQL functions. `listDue` uses the partial index `pause_requests_due_idx`. The write lock order is circle, then season, then the pause rows (respond, cancel and resume guard the circle only). There is still no notifier.
- **Review tables (change `periodic-review`, ADR-0014):** `reviews` (root) and `automaticity_responses` (one row per Commitment, no foreign key to the Commitment, cascading from the root). `reviews_season_member_period_key` is the idempotency key: a duplicate insert maps to `ConcurrencyConflict`. Named CHECKs pin the shape (`reviews_kind_shape`, `reviews_status_shape`, scores between 1 and 7); RLS on with no policies and a revoke from the client roles; no triggers or functions. Still no notifier.
- **Tests:** real Postgres 17. Testcontainers locally; in CI the `db` job runs a `postgres:17` service container and sets `TEST_DATABASE_URL`, where the harness creates a fresh database on that server (the `ci` job skips `@pactjoy/db`). A missing database fails the run, never skips it. The same adapter-neutral contract suites (`@pactjoy/app/contracts`) run against the in-memory adapters and Postgres.
- **Composition:** `createPostgresUnitOfWork({ url, max?, connectTimeoutSeconds? })` is the only runtime export; connections open lazily and `end()` closes the pool.

### Open items for change C (the `api` function)

- Validate identifier formats at the API boundary: the invite code goes straight to `findByInviteCode`, so a lone surrogate would reach the driver as a bound parameter; the same for ids in request bodies (uuid format) and `clientRequestId`.
- The error-to-HTTP mapping must cover every app error kind, including the newer ones (invalid why, category and note, the custom-label errors, frequency and weekday errors, precision errors, `IdempotencyKeyReused`, `EntryDeleted`, `InvalidClientRequestId`).
- No `Promise.all` inside a transaction (one connection, statements are sequential).
- Verify once against production what could not be tested locally: the hosted Supavisor, TLS and Edge cold starts. Use the pooler (6543, transaction mode) for the function and the direct URL for migrations (`supabase db push`).
- Add a CI or startup check of the Data API exposed schemas, so SS-S3 stops depending on a manual step.
- Extend the SS-S9 and DC-S16 import scans to `supabase/functions` and Deno specifiers (`npm:`, `jsr:`, `deno.land/x/postgres`, backtick imports).
- Decide whether to manage hosted settings with `supabase config push`.
- The custom-label length counts UTF-16 units while the note limit counts code points; revisit only if it becomes user-facing.

### Operational checklist (hosted Supabase, manual)

- Data API exposed schemas: only `public` and `graphql_public`, or disable the Data API. `pactjoy` must not be listed.
- Before `supabase db push`, check `pg_default_acl` for the migrating role.
- After the push, verify:
  - `has_schema_privilege('anon', 'pactjoy', 'USAGE')` is false (same for `authenticated`);
  - `pg_policies` has 0 rows for schema `pactjoy`;
  - no `pactjoy` table has RLS off (`pg_class.relrowsecurity`).
- Use a dedicated database password or role for the adapter. Use the pooler URL (6543) at runtime and the direct URL for migrations. Never use the service-role key.
- Add the `db` CI check to branch protection.

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

### Neutral

- Client roles have no access to `pactjoy`; all access goes through the `api` function and its use cases.

## References

- [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0009](0009-time-model-in-packages-app.md)
- `supabase/migrations/`, `packages/db/test/`

## Addendum: season closures and graduation (change `season-close-graduation`, ADR-0015)

- Two tables, `pactjoy.season_closures` (unique `season_closures_season_member_key` on `(season_id, member_id)`) and `pactjoy.season_closure_decisions` (children, `ON DELETE CASCADE`, `commitment_id` without a foreign key because commitments live inside the season), and one column, `habits.graduated_at timestamptz` (nullable, no backfill). RLS is on with no policies and the client roles are revoked; there are no triggers and no functions.
- `season_closures_pkey` and `season_closures_season_member_key` are in `CONFLICT_CONSTRAINTS`, so a duplicate insert maps to `ConcurrencyConflict`.
- `SeasonRepository.listByCircle` orders by `insert_seq desc`.
- Real-Postgres tests cover the contract, every CHECK, RLS and revoke, a concurrent double submit and the two last closers racing (`season-close-concurrency.pg.test.ts`).

## Addendum: photo evidence (change `photo-evidence`, ADR-0016)

- One table, `pactjoy.entry_photos` (the upload ledger: `id`, `season_id` RESTRICT, `member_id`, `commitment_id`, `object_key` unique and CHECKed to `o/` + 32 hex + `.jpg`, `byte_size` 1..3 MiB, `content_type` = `image/jpeg`, `status` in `pending | attached | released`, `created_at`, `attach_by` after it, `version`), indexes `(member_id, status)` and `(status, attach_by)`, and one column, `entries.photo_id uuid` (nullable, no backfill) with `entries_photo_id_fkey` RESTRICT, `entries_photo_id_key` UNIQUE and `entries_photo_shape` (a tombstone keeps no photo). RLS is on with no policies and the client roles are revoked; there are no triggers and no functions.
- `entry_photos_pkey`, `entry_photos_object_key_key` and `entries_photo_id_key` are in `CONFLICT_CONSTRAINTS`, so a duplicate id or key, or a second Entry claiming one photo, maps to `ConcurrencyConflict`. Two attaches of one photo lose on the `version`-guarded UPDATE (`WHERE id = $1 AND version = $2`, affected rows checked).
- Locks: a ledger save updates `status` and `version` only, never a key column, so it takes FOR NO KEY UPDATE and does not block the KEY SHARE the `entries.photo_id` foreign key takes on the row. Updating `entries.photo_id` (a unique column) takes FOR UPDATE on the entry row, which is safe because nothing references `entries`. `releaseExpired` selects `FOR UPDATE SKIP LOCKED`, so concurrent sweeps release disjoint rows.
- Real-Postgres tests (`entry-photo.pg.test.ts`) cover the shared contract, every CHECK, RLS and revoke, the foreign key and unique key, the tombstone CHECK, a concurrent double attach and disjoint concurrent sweeps.

## Addendum: social layer (change `social-reactions`, ADR-0018)

- Three tables, none with a foreign key to a member or a commitment (their rows are replaced wholesale on every season save) and none referenced by another table; each has a foreign key to `seasons` that is RESTRICT. RLS is on with no policies and the client roles are revoked; there are no triggers and no functions. The feed itself is derived and stores nothing.
  - `pactjoy.feed_reactions`: `id`, `season_id`, `item_key` (CHECKed to the pinned shape `^[a-z-]+(:[0-9A-Za-z-]+)+$` and at most 120 characters, the same bound as the application), `member_id`, `emoji` in `heart | raisedHands | fire | clap`, `reacted_at`, `version`. Unique `feed_reactions_season_item_member_key` on `(season_id, item_key, member_id)`, whose leading column also serves the season-wide read.
  - `pactjoy.encouragements`: `id`, `season_id`, `sender_member_id`, `recipient_member_id` (CHECK sender <> recipient), `case_week` 1..12, `emoji`, `sent_at`, `sent_on date`. Unique `encouragements_case_key` on `(season_id, sender, recipient, case_week)` and `encouragements_daily_key` on `(sender, recipient, sent_on)`, so "one per case" and "one per person per day" are atomic with the write. Index `(season_id, recipient_member_id)`. Insert-only.
  - `pactjoy.nudge_dismissals`: primary key `nudge_dismissals_pkey` on `(season_id, viewer_member_id, target_member_id, case_week)`, `dismissed_at`, `dismissed_on date`.
- `feed_reactions_pkey`, `feed_reactions_season_item_member_key`, `encouragements_pkey`, `encouragements_case_key`, `encouragements_daily_key` and `nudge_dismissals_pkey` are in `CONFLICT_CONSTRAINTS`. A dismissal never surfaces its primary key: the repository inserts with `ON CONFLICT DO NOTHING`, so a double tap or a race keeps the first row and raises nothing (the port is idempotent). A reaction update is a `version`-guarded UPDATE of `emoji` and `version` only (`reacted_at` is kept); `remove` is a version-guarded DELETE, and a stale or missing row is a `ConcurrencyConflict`.
- The per-member columns that job E deletes or anonymizes are listed in the migration header: `feed_reactions.member_id`, `encouragements.sender_member_id`, `encouragements.recipient_member_id`, `nudge_dismissals.viewer_member_id`, `nudge_dismissals.target_member_id`.
- Real-Postgres tests (`social.pg.test.ts`) cover the three shared contracts, every CHECK, both unique keys, RLS and revoke, the absence of foreign keys to members, the RESTRICT keys, a concurrent first reaction and concurrent dismissals.

## Addendum: the notification outbox and push subscriptions (change `scheduled-jobs-notifications`, ADR-0017)

- Two tables. `pactjoy.notification_outbox` is keyed by `dedupe_key` (1..200 characters), with `kind` CHECKed to the closed list, `params` a JSON object (ids only), `circle_id`, `season_id` (nullable), `recipient_member_id`, `recipient_user_id`, `time_zone`, `not_before`, `expires_at`, `rollovers_left` 0..1, `state` in `pending | sending | sent | dropped | failed`, `attempts` >= 0, `lease_until` set exactly while `sending`, and `outcome` and `finished_at` set exactly in a final state. Indexes `(state, not_before)`, `(recipient_user_id)`, `(finished_at)`. `pactjoy.push_subscriptions` has `endpoint` unique (https, at most 1024 characters), `p256dh` and `auth` CHECKed to their base64url shapes, and an index on `user_id`.
- No foreign keys at all: members and commitments are replaced wholesale by their aggregate's save, a pact-open season can be discarded, and erasure (change E) deletes these rows itself. Dispatch drops a row whose season or pause is gone. RLS on, no policies, client roles revoked, no triggers, no functions.
- `enqueue` is `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING` and `upsert` is `ON CONFLICT (endpoint) DO UPDATE`, so neither raises and neither needs an entry in `CONFLICT_CONSTRAINTS`.
- The claim is one `UPDATE ... RETURNING` over a `FOR UPDATE SKIP LOCKED` selection (no SQL function), committed on its own; `finish` and `reschedule` are fenced `WHERE state = 'sending' AND attempts = $claimed`. Sending happens between those transactions, never inside one. `notifications.pg.test.ts` covers every CHECK, two concurrent claims taking disjoint rows, the absence of foreign keys and a full dispatch over Postgres.
