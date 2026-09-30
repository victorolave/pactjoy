-- PactJoy persistence, step 0: the dedicated schema (ADR-0010).
--
-- Every table lives in `pactjoy`, which the Supabase Data API does not
-- expose, and client roles get no access to it. Plain portable SQL only: no
-- triggers, no functions, no reference to `auth.*` (CLAUDE.md, architecture).
-- Migrations are forward-only; rollback on Supabase is
-- `drop schema pactjoy cascade`.

create schema pactjoy;

revoke all on schema pactjoy from public, anon, authenticated;
