-- PactJoy persistence, scheduled jobs and Web Push (ADR-0017, change
-- `scheduled-jobs-notifications`).
--
-- `notification_outbox` is the TRANSACTIONAL OUTBOX: a use case adds a row in the
-- same transaction as the change it announces (nothing leaves the process inside a
-- transaction, ADR-0010), and the `dispatch-notifications` job sends it later.
--
--   pending   waiting for `not_before`
--   sending   claimed by a dispatcher until `lease_until`; past it, another may claim it
--   sent      at least one device accepted it
--   dropped   not sent on purpose (expired, no longer relevant, recipient left, no device)
--   failed    every attempt failed, or the push service refused it
--
-- The primary key is the DEDUPE KEY: one row per event and recipient. Enqueuing it
-- again is `ON CONFLICT DO NOTHING`, which is what makes every job and every enqueue
-- site re-runnable. A claim is one UPDATE over a `FOR UPDATE SKIP LOCKED` selection,
-- so concurrent dispatchers take disjoint rows; finishing a row is fenced by its
-- state and attempt count.
--
-- `params` holds ids only (never a name, a note or a value). There are NO foreign
-- keys: a pact-open season can be discarded, members and commitments are replaced
-- wholesale by their aggregate's save, and an erased member's rows are deleted by
-- account deletion (change E); dispatch drops a row whose subject is gone. There are
-- NO triggers and NO SQL functions: only representational CHECKs. The allowed kinds
-- are the closed list of `NotificationKind` (adding one is a new migration).
--
-- RLS is on with NO policies and the client roles are revoked. Additive and
-- forward-only: rollback is dropping the table.

create table pactjoy.notification_outbox (
  dedupe_key text constraint notification_outbox_pkey primary key
    constraint notification_outbox_dedupe_key_check check (char_length(dedupe_key) between 1 and 200),
  kind text not null
    constraint notification_outbox_kind_check check (kind in (
      'pauseRequested', 'pauseApproved', 'pauseRejected', 'pauseEndsTomorrow',
      'pactPendingApproval', 'seasonStarted', 'reviewDue', 'seasonClosed'
    )),
  params jsonb not null
    constraint notification_outbox_params_check check (jsonb_typeof(params) = 'object'),
  circle_id uuid not null,
  season_id uuid,
  recipient_member_id uuid not null,
  recipient_user_id uuid not null,
  time_zone text not null
    constraint notification_outbox_time_zone_check check (char_length(time_zone) between 1 and 64),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  rollovers_left smallint not null
    constraint notification_outbox_rollovers_left_check check (rollovers_left between 0 and 1),
  state text not null
    constraint notification_outbox_state_check check (state in ('pending', 'sending', 'sent', 'dropped', 'failed')),
  attempts smallint not null constraint notification_outbox_attempts_check check (attempts >= 0),
  lease_until timestamptz,
  outcome text
    constraint notification_outbox_outcome_check check (outcome in (
      'delivered', 'noSubscription', 'expired', 'irrelevant', 'recipientLeft', 'rejected', 'exhausted'
    )),
  created_at timestamptz not null,
  finished_at timestamptz,
  constraint notification_outbox_lease_check check ((state = 'sending') = (lease_until is not null)),
  constraint notification_outbox_finished_check check (
    (state in ('sent', 'dropped', 'failed')) = (finished_at is not null and outcome is not null)
  )
);

-- The claim: due pending rows and expired leases, oldest first.
create index notification_outbox_state_not_before_idx on pactjoy.notification_outbox (state, not_before);
-- Account deletion (change E) deletes a user's rows.
create index notification_outbox_recipient_user_id_idx on pactjoy.notification_outbox (recipient_user_id);
-- The retention purge.
create index notification_outbox_finished_at_idx on pactjoy.notification_outbox (finished_at);

alter table pactjoy.notification_outbox enable row level security;

revoke all on pactjoy.notification_outbox from public, anon, authenticated;
