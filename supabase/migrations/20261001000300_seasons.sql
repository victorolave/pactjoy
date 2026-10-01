-- PactJoy persistence, step 3: seasons, their commitments and their approvals (ADR-0010).
--
-- A season save must NEVER update a key column of `seasons` (any column of a
-- primary key or a non-partial unique index, or a foreign key): the guard holds
-- FOR NO KEY UPDATE, and updating a key column would upgrade it to FOR UPDATE,
-- which can deadlock against the KEY SHARE lock a concurrent foreign-key check
-- holds (an entry insert). `id`, `circle_id` and `insert_seq` are written once,
-- on insert, and never SET afterwards.
--
-- `insert_seq` mirrors the in-memory insertion order that `findLatestByCircle`
-- relies on. It is NOT `created_at`, which ties under a fixed clock.
--
-- Commitments and approvals are children, replaced wholesale on every save, and
-- ordered by `position` (their index in the season's arrays). Nothing references
-- them: entries will reference the season only, never a commitment. They cascade
-- with the season; the season itself is RESTRICTed by its circle (and, later,
-- by its entries).
--
-- Business ranges (length, cadence, weights) stay in TypeScript; only
-- representational CHECKs live here. Every constraint is named.
-- RLS is on with NO policies.

create table pactjoy.seasons (
  id uuid constraint seasons_pkey primary key,
  circle_id uuid not null
    constraint seasons_circle_id_fkey references pactjoy.circles (id) on delete restrict,
  insert_seq bigint generated always as identity,
  time_zone text not null,
  nominal_start date not null,
  actual_start date,
  length_weeks smallint not null,
  review_cadence_weeks smallint not null,
  status text not null constraint seasons_status_check check (status in ('pactOpen', 'active', 'closed')),
  pact_closed_at timestamptz,
  created_at timestamptz not null,
  version integer not null constraint seasons_version_check check (version >= 0)
);

create index seasons_circle_latest_idx on pactjoy.seasons (circle_id, insert_seq desc);

create table pactjoy.season_commitments (
  season_id uuid not null
    constraint season_commitments_season_id_fkey references pactjoy.seasons (id) on delete cascade,
  position smallint not null constraint season_commitments_position_check check (position >= 0),
  id uuid not null,
  member_id uuid not null,
  habit_id uuid not null,
  weight_percent smallint not null,
  privacy text not null constraint season_commitments_privacy_check check (privacy in ('visible', 'private')),
  measure jsonb not null,
  constraint season_commitments_pkey primary key (season_id, position)
);

create table pactjoy.season_approvals (
  season_id uuid not null
    constraint season_approvals_season_id_fkey references pactjoy.seasons (id) on delete cascade,
  position smallint not null constraint season_approvals_position_check check (position >= 0),
  member_id uuid not null,
  approved_at timestamptz not null,
  constraint season_approvals_pkey primary key (season_id, position),
  constraint season_approvals_member_key unique (season_id, member_id)
);

alter table pactjoy.seasons enable row level security;
alter table pactjoy.season_commitments enable row level security;
alter table pactjoy.season_approvals enable row level security;
