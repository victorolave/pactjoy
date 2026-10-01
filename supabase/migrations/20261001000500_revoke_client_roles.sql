-- PactJoy persistence, last step: close every door the client roles could use
-- (ADR-0010, security model).
--
-- In-repo protection: client roles have no USAGE on the schema (000000), RLS is
-- enabled on every table with no policies, and this file removes any privilege
-- `anon`, `authenticated` or PUBLIC could hold on existing tables and
-- sequences. Keeping `pactjoy` out of the Supabase Data API's exposed schemas
-- is a MANUAL hosted setting, not configured here (ADR-0010, operational
-- checklist).
--
-- Default privileges: Supabase grants everything on new objects to `anon` and
-- `authenticated` through a GLOBAL default ACL of the migrating role. An
-- in-schema revoke does NOT cancel a global grant (verified on PG17), so the
-- global revoke is required. It applies to the migrating role in this database
-- only; objects created later by that role in any schema start ungranted.
--
-- Forward-only and safe to re-run: REVOKE of a privilege that is not held is a
-- no-op. Rollback on Supabase is `drop schema pactjoy cascade`.

revoke all on all tables in schema pactjoy from public, anon, authenticated;
revoke all on all sequences in schema pactjoy from public, anon, authenticated;

alter default privileges revoke all on tables from public, anon, authenticated;
alter default privileges revoke all on sequences from public, anon, authenticated;

alter default privileges in schema pactjoy revoke all on tables from public, anon, authenticated;
alter default privileges in schema pactjoy revoke all on sequences from public, anon, authenticated;
