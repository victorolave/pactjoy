-- PactJoy persistence, rate-limit counters (ADR-0020, change `join-rate-limit`,
-- the ADR-0011 Q17 follow-up).
--
-- One row per fixed window of one subject: how many join attempts
-- (`POST /circles/join/preview` and `POST /circles/join`) it made in that window.
--
--   action          what the counter limits; a closed list
--   subject         `user:<user id>` or `network:<keyed hash>`. The API stores a
--                   client network only as an HMAC under a server secret, never the
--                   address itself.
--   window_start    the window's start, aligned to the epoch
--   window_seconds  the window's length (60 or 3600 today)
--   expires_at      window_start + window_seconds, so the sweep is one indexed delete
--   hits            attempts so far, refused ones included
--
-- Each hit is an atomic `insert ... on conflict ... do update ... returning`; the
-- limits and windows are decided by the application. Ended windows are deleted
-- lazily by the next attempt: there is NO job, NO trigger and NO SQL function.
-- Account deletion (ADR-0019) deletes a user's rows by their `user:` subject.
--
-- RLS is on with NO policies and the client roles are revoked. Additive and
-- forward-only: rollback is dropping the table.

create table pactjoy.rate_limit_counters (
  action text not null constraint rate_limit_counters_action_check check (action in ('joinCircle')),
  subject text not null
    constraint rate_limit_counters_subject_check check (subject ~ '^(user|network):[A-Za-z0-9_-]{1,64}$'),
  window_start timestamptz not null,
  window_seconds integer not null
    constraint rate_limit_counters_window_seconds_check check (window_seconds > 0),
  expires_at timestamptz not null,
  hits integer not null constraint rate_limit_counters_hits_check check (hits >= 1),
  constraint rate_limit_counters_pkey primary key (action, subject, window_seconds, window_start)
);

create index rate_limit_counters_expires_at_idx on pactjoy.rate_limit_counters (expires_at);

alter table pactjoy.rate_limit_counters enable row level security;

revoke all on pactjoy.rate_limit_counters from public, anon, authenticated;
