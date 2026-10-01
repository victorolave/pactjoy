-- PactJoy persistence, step 2: circles, their members and their invite (ADR-0010).
--
-- A circle save must NEVER update a key column of `circles` (any column of a
-- primary key or a non-partial unique index): the guard holds FOR NO KEY
-- UPDATE, and updating a key column would upgrade it to FOR UPDATE, which can
-- deadlock against the KEY SHARE lock a concurrent foreign-key check holds.
-- That is why the invite (whose code is globally unique) lives in the child
-- table `circle_invites`, replaced by a save, not on `circles`.
--
-- `circle_members.position` is the member's index in `Circle.members`: it is
-- what makes the order stable, ties in `joined_at` included.
-- `user_id` / `created_by` are plain uuids (no FK to auth, no FK into members).
-- Children are replaced wholesale, so nothing references them.
-- Every constraint is named, because the error mapping keys on constraint names.
-- RLS is on with NO policies.

create table pactjoy.circles (
  id uuid constraint circles_pkey primary key,
  name text not null,
  created_at timestamptz not null,
  archived_at timestamptz,
  version integer not null constraint circles_version_check check (version >= 0)
);

create table pactjoy.circle_members (
  id uuid constraint circle_members_pkey primary key,
  circle_id uuid not null
    constraint circle_members_circle_id_fkey references pactjoy.circles (id) on delete restrict,
  position smallint not null constraint circle_members_position_check check (position >= 0),
  user_id uuid not null,
  status text not null constraint circle_members_status_check check (status in ('active', 'left')),
  joined_at timestamptz not null,
  left_at timestamptz,
  constraint circle_members_left_at_check check ((status = 'left') = (left_at is not null)),
  constraint circle_members_position_key unique (circle_id, position)
);

create index circle_members_active_user_idx on pactjoy.circle_members (user_id)
  where status = 'active';

create table pactjoy.circle_invites (
  circle_id uuid constraint circle_invites_pkey primary key
    constraint circle_invites_circle_id_fkey references pactjoy.circles (id) on delete restrict,
  code text not null constraint circle_invites_code_key unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  created_by uuid not null
);

alter table pactjoy.circles enable row level security;
alter table pactjoy.circle_members enable row level security;
alter table pactjoy.circle_invites enable row level security;
