-- PactJoy persistence, Web Push subscriptions (ADR-0017, change
-- `scheduled-jobs-notifications`).
--
-- One row per device a user subscribed. The endpoint is unique: the same browser
-- signing in as someone else moves its row to that user (one endpoint, one user).
-- `p256dh` and `auth` are the device's encryption keys, base64url as the browser
-- gives them (a 65-byte P-256 point, a 16-byte secret). A push service answering
-- 404/410 makes the dispatcher delete the row.
--
-- Subscriptions are user-level: no circle or member column. There is NO foreign key
-- to auth (security test SS-S8); account deletion (change E) deletes by `user_id`.
-- There are NO triggers and NO SQL functions: which hosts are allowed and how many
-- devices a user keeps are checked by the application.
--
-- RLS is on with NO policies and the client roles are revoked. Additive and
-- forward-only: rollback is dropping the table.

create table pactjoy.push_subscriptions (
  id uuid constraint push_subscriptions_pkey primary key,
  user_id uuid not null,
  endpoint text not null
    constraint push_subscriptions_endpoint_check check (endpoint ~ '^https://' and char_length(endpoint) <= 1024),
  p256dh text not null
    constraint push_subscriptions_p256dh_check check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null
    constraint push_subscriptions_auth_check check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index push_subscriptions_user_id_idx on pactjoy.push_subscriptions (user_id);

alter table pactjoy.push_subscriptions enable row level security;

revoke all on pactjoy.push_subscriptions from public, anon, authenticated;
