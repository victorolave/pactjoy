-- PactJoy: Season.pactRevision (change pact-integrity, PI-1).
--
-- Counts how many times the content the members approve changed (params,
-- commitments, members). The app bumps it whenever approvals are reset; it is
-- the precondition for approving a pact. No business logic lives here: this is
-- only the column and a sanity check.
--
-- Forward-only. Existing rows start at 0. Adding a column with a constant
-- default is metadata-only on PG11+. No grant is needed: the table-level
-- privileges were revoked in 000500 and a new column carries no ACL of its own.

alter table pactjoy.seasons
  add column pact_revision integer not null default 0
  constraint seasons_pact_revision_check check (pact_revision >= 0);
