-- PactJoy: one active circle per user, enforced by the database (change
-- unique-active-circle, CP-R10, A5).
--
-- The use cases check "already in an active circle" before writing, but two
-- concurrent requests (create + join, create + create) both pass the check.
-- A unique partial index closes the race: the loser's insert raises 23505 on
-- `circle_members_active_user_key`, which the adapter maps to
-- ConcurrencyConflict (409). No business logic lives here, only the structure.
--
-- It replaces the non-unique `circle_members_active_user_idx` from 000200
-- (same columns and predicate), so the lookup index is not duplicated.
--
-- Forward-only. No dedupe: if a database already holds a user with two active
-- rows, `create unique index` fails loudly with 23505 and the migration is
-- aborted for a human to resolve. Before applying to a hosted database run:
--   select user_id from pactjoy.circle_members
--   where status = 'active' group by 1 having count(*) > 1;
-- Not CONCURRENTLY: migrations run inside a transaction and the table is tiny.
-- No grant is needed: the table-level privileges were revoked in 000500.

drop index pactjoy.circle_members_active_user_idx;

create unique index circle_members_active_user_key on pactjoy.circle_members (user_id)
  where status = 'active';
