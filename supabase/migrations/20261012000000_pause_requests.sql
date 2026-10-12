-- PactJoy persistence, pause requests (ADR-0013, change `pause-workflow`).
--
-- A Pause request is ONE aggregate: a root (`pause_requests`), the Commitments
-- it covers (`pause_request_commitments`, one row each, with its own early
-- resume) and each approver's current answer (`pause_responses`). "Todos" is a
-- single root with several children, so a request has one status and one
-- version. A save is a version-checked UPDATE of the root with the children
-- replaced wholesale; it never updates a key column (`id`, `season_id`,
-- `insert_seq`), so the row lock it takes is FOR NO KEY UPDATE and does not
-- block the KEY SHARE locks of foreign-key checks.
--
-- `status`/`decided_at`/`decided_on` hold what has been PERSISTED. A pending
-- request turns approved at `auto_approve_at` with no job having run, so the
-- decision a reader acts on is derived in the application (`effectiveDecision`),
-- never here. There are NO triggers and NO SQL functions: only representational
-- CHECKs (value sets, non-negative days, the shape of a decision). Ordering and
-- retroactivity rules, the cap and overlaps stay in the application.
--
-- The only foreign key from the root is to the season ROOT, RESTRICT: a season
-- that has pause requests cannot be deleted. There is none to a commitment
-- (children of a season are replaced wholesale on every save, same as entries)
-- nor to a member. The two child tables cascade with their request.
--
-- `insert_seq` is the creation order `listBySeason` relies on. Every constraint
-- is named. RLS is on with NO policies, and the client roles are revoked.
-- Additive and forward-only: rollback is dropping the three tables, children first.

create table pactjoy.pause_requests (
  id uuid constraint pause_requests_pkey primary key,
  season_id uuid not null
    constraint pause_requests_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  insert_seq bigint generated always as identity,
  member_id uuid not null,
  reason text not null
    constraint pause_requests_reason_check check (reason in ('health', 'travel', 'work', 'other')),
  note text,
  requested_at timestamptz not null,
  requested_on integer not null constraint pause_requests_requested_on_check check (requested_on >= 0),
  start_day integer not null constraint pause_requests_start_day_check check (start_day >= 0),
  -- null means an open pause ("until I resume").
  last_day integer constraint pause_requests_last_day_check check (last_day >= 0),
  auto_approve_at timestamptz not null,
  status text not null
    constraint pause_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at timestamptz,
  decided_on integer constraint pause_requests_decided_on_check check (decided_on >= 0),
  version integer not null constraint pause_requests_version_check check (version >= 0),
  constraint pause_requests_decision_shape check (
    ((status = 'pending') = (decided_at is null)) and ((decided_at is null) = (decided_on is null))
  )
);

create index pause_requests_season_idx on pactjoy.pause_requests (season_id, insert_seq);
-- `listDue`: only pending requests can be due, so the index stays small as requests are decided.
create index pause_requests_due_idx on pactjoy.pause_requests (auto_approve_at) where status = 'pending';

create table pactjoy.pause_request_commitments (
  pause_request_id uuid not null
    constraint pause_request_commitments_request_fkey
    references pactjoy.pause_requests (id) on delete cascade,
  commitment_id uuid not null,
  position integer not null constraint pause_request_commitments_position_check check (position >= 0),
  resumed_on integer constraint pause_request_commitments_resumed_on_check check (resumed_on >= 0),
  resumed_at timestamptz,
  constraint pause_request_commitments_pkey primary key (pause_request_id, commitment_id),
  constraint pause_request_commitments_resume_shape check ((resumed_on is null) = (resumed_at is null))
);

create table pactjoy.pause_responses (
  pause_request_id uuid not null
    constraint pause_responses_request_fkey references pactjoy.pause_requests (id) on delete cascade,
  member_id uuid not null,
  response text not null constraint pause_responses_response_check check (response in ('approve', 'reject')),
  responded_at timestamptz not null,
  constraint pause_responses_pkey primary key (pause_request_id, member_id)
);

alter table pactjoy.pause_requests enable row level security;
alter table pactjoy.pause_request_commitments enable row level security;
alter table pactjoy.pause_responses enable row level security;

revoke all on pactjoy.pause_requests, pactjoy.pause_request_commitments, pactjoy.pause_responses
  from public, anon, authenticated;
