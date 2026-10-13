-- PactJoy persistence, season closures (change `season-close-graduation`).
--
-- A SeasonClosure is ONE aggregate per (season, member): a root (`season_closures`)
-- and the member's decision about each of their Commitments
-- (`season_closure_decisions`, one row each: continue, adjust, pause or graduate).
-- A saved closure is final: it is inserted once and never edited, so `version`
-- stays 0.
--
-- The UNIQUE key `(season_id, member_id)` is what makes a double submit
-- idempotent: the loser of a race gets 23505 on
-- `season_closures_season_member_key`, which the unit of work maps to
-- ConcurrencyConflict. Who still has to close, when the season may move on and
-- whether it is finalized are DERIVED in the application; nothing is stored for
-- them here.
--
-- There are NO triggers and NO SQL functions: only representational CHECKs
-- (value sets, ranges). Coverage of the member's Commitments, the calendar gates,
-- the closing review requirement and finalization stay in the application.
--
-- The only foreign key from the root is to the season ROOT, RESTRICT. There is
-- none to a member, and none from a decision to a Commitment (children of a
-- season are replaced wholesale on every save, same as entries). Decisions
-- cascade with their closure.
--
-- Decisions are private to their owner. The application's port has no
-- season-wide read of decisions, and RLS is on with NO policies, with the client
-- roles revoked. Additive and forward-only: rollback is dropping the two tables,
-- `season_closure_decisions` first.

create table pactjoy.season_closures (
  id uuid constraint season_closures_pkey primary key,
  season_id uuid not null
    constraint season_closures_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  insert_seq bigint generated always as identity,
  member_id uuid not null,
  decided_at timestamptz not null,
  version integer not null constraint season_closures_version_check check (version >= 0),
  constraint season_closures_season_member_key unique (season_id, member_id)
);

create table pactjoy.season_closure_decisions (
  closure_id uuid not null
    constraint season_closure_decisions_closure_fkey
      references pactjoy.season_closures (id) on delete cascade,
  commitment_id uuid not null,
  position integer not null
    constraint season_closure_decisions_position_check check (position >= 0),
  decision text not null
    constraint season_closure_decisions_decision_check
      check (decision in ('continue', 'adjust', 'pause', 'graduate')),
  constraint season_closure_decisions_pkey primary key (closure_id, commitment_id)
);

alter table pactjoy.season_closures enable row level security;
alter table pactjoy.season_closure_decisions enable row level security;

revoke all on pactjoy.season_closures, pactjoy.season_closure_decisions
  from public, anon, authenticated;
