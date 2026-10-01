-- PactJoy persistence, step 4: entries (ADR-0010).
--
-- Entries are the source of truth for scoring. A delete turns the row into a
-- TOMBSTONE (`deleted = true`, value and note blanked) instead of removing it,
-- so the idempotency key stays taken: `entries_client_request_key` is a plain
-- unique constraint over (member, commitment, client request id) and is NOT
-- partial. A `WHERE NOT deleted` index would free a deleted entry's key again.
--
-- The only foreign key is to the season ROOT, RESTRICT: a season that has
-- entries cannot be deleted. There is no foreign key to a commitment (children
-- of a season are replaced wholesale on every save) nor to a member.
--
-- `insert_seq` is the insertion order `listBySeason` relies on, because
-- `recorded_at` can tie. An entry edit never updates a key column of this table.
--
-- A quantity is an exact fraction: `value_num` / `value_den`, both bigint, never
-- a float or numeric. Only representational CHECKs live here. Every constraint
-- is named. RLS is on with NO policies.

create table pactjoy.entries (
  id uuid constraint entries_pkey primary key,
  season_id uuid not null
    constraint entries_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  insert_seq bigint generated always as identity,
  member_id uuid not null,
  commitment_id uuid not null,
  client_request_id text not null,
  day integer not null constraint entries_day_check check (day >= 0),
  recorded_on integer not null constraint entries_recorded_on_check check (recorded_on >= 0),
  recorded_at timestamptz not null,
  edited_at timestamptz,
  version integer not null constraint entries_version_check check (version >= 0),
  request_fingerprint text not null,
  deleted boolean not null,
  value_kind text constraint entries_value_kind_check check (value_kind in ('done', 'quantity', 'missed')),
  value_num bigint,
  value_den bigint constraint entries_value_den_check check (value_den > 0),
  note text,
  constraint entries_client_request_key unique (member_id, commitment_id, client_request_id),
  constraint entries_value_shape check (
    (deleted and value_kind is null and value_num is null and value_den is null and note is null)
    or (
      not deleted
      and value_kind is not null
      and ((value_kind = 'quantity') = (value_num is not null))
      and ((value_num is null) = (value_den is null))
    )
  )
);

create index entries_season_live_idx on pactjoy.entries (season_id, insert_seq) where not deleted;

alter table pactjoy.entries enable row level security;
