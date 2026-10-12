-- PactJoy persistence, periodic reviews (ADR-0014, change `periodic-review`).
--
-- A Review is ONE aggregate per (season, member, period): a root (`reviews`) and
-- the member's SRBAI answers about each of their Commitments
-- (`automaticity_responses`, one row each). Period 0 is the baseline. A saved
-- review is final: it is inserted once and never edited (a Pause request is
-- replaced wholesale; a review is not), so `version` stays 0 in this change.
--
-- The UNIQUE key `(season_id, member_id, period_index)` is what makes a double
-- submit idempotent: the loser of a race gets 23505 on
-- `reviews_season_member_period_key`, which the unit of work maps to
-- ConcurrencyConflict. Whether a review is pending, due or lapsed is DERIVED in
-- the application from the season calendar; nothing is stored for it.
--
-- There are NO triggers and NO SQL functions: only representational CHECKs
-- (value sets, ranges, the shape of a row). Which period is due, full versus
-- item-1 SRBAI, Commitment coverage and the baseline-only skip rule stay in the
-- application.
--
-- The only foreign key from the root is to the season ROOT, RESTRICT. There is
-- none to a member, and none from a response to a Commitment (children of a
-- season are replaced wholesale on every save, same as entries). Responses
-- cascade with their review.
--
-- Reviews are private to their owner. The application's port has no
-- season-wide read, and RLS is on with NO policies, with the client roles
-- revoked. Additive and forward-only: rollback is dropping the two tables,
-- `automaticity_responses` first.

create table pactjoy.reviews (
  id uuid constraint reviews_pkey primary key,
  season_id uuid not null
    constraint reviews_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  insert_seq bigint generated always as identity,
  member_id uuid not null,
  -- 0 is the baseline; 1..P are the periods of the season.
  period_index integer not null constraint reviews_period_index_check check (period_index >= 0),
  kind text not null
    constraint reviews_kind_check check (kind in ('baseline', 'interim', 'closing')),
  status text not null
    constraint reviews_status_check check (status in ('completed', 'skipped')),
  -- null only for a skipped baseline.
  srbai text constraint reviews_srbai_check check (srbai in ('full', 'item1')),
  reflection_helped text,
  reflection_hard text,
  recorded_at timestamptz not null,
  version integer not null constraint reviews_version_check check (version >= 0),
  constraint reviews_season_member_period_key unique (season_id, member_id, period_index),
  constraint reviews_kind_shape check ((kind = 'baseline') = (period_index = 0)),
  -- A completed review says how it was answered; a skip carries no answers and no reflection.
  constraint reviews_status_shape check (
    ((status = 'completed') = (srbai is not null))
    and (status = 'completed' or (reflection_helped is null and reflection_hard is null))
  )
);

create table pactjoy.automaticity_responses (
  review_id uuid not null
    constraint automaticity_responses_review_fkey references pactjoy.reviews (id) on delete cascade,
  commitment_id uuid not null,
  position integer not null constraint automaticity_responses_position_check check (position >= 0),
  -- Item 1 is always answered; items 2-4 only in a full review. 1..7 scale.
  item1 smallint not null constraint automaticity_responses_item1_check check (item1 between 1 and 7),
  item2 smallint constraint automaticity_responses_item2_check check (item2 between 1 and 7),
  item3 smallint constraint automaticity_responses_item3_check check (item3 between 1 and 7),
  item4 smallint constraint automaticity_responses_item4_check check (item4 between 1 and 7),
  constraint automaticity_responses_pkey primary key (review_id, commitment_id)
);

alter table pactjoy.reviews enable row level security;
alter table pactjoy.automaticity_responses enable row level security;

revoke all on pactjoy.reviews, pactjoy.automaticity_responses from public, anon, authenticated;
