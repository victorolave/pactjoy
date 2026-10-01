-- PactJoy persistence, last step: close every door the client roles could use
-- (ADR-0010, security model).
--
-- `pactjoy` is not exposed by the Supabase Data API, RLS is enabled on every
-- table with no policies, and this file removes any privilege `anon`,
-- `authenticated` or PUBLIC could hold on existing tables and sequences. The
-- default-privilege lines cover objects created later by the migrating role.
-- Forward-only and safe to re-run: REVOKE of a privilege that is not held is a
-- no-op. Rollback on Supabase is `drop schema pactjoy cascade`.

revoke all on all tables in schema pactjoy from public, anon, authenticated;
revoke all on all sequences in schema pactjoy from public, anon, authenticated;

alter default privileges in schema pactjoy revoke all on tables from public, anon, authenticated;
alter default privileges in schema pactjoy revoke all on sequences from public, anon, authenticated;
