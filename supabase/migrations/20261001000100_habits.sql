-- PactJoy persistence, step 1: habits (ADR-0010).
--
-- `owner_id` is a plain uuid: no foreign key to `auth.*` (the domain never
-- depends on the auth vendor). Every constraint is named, because the error
-- mapping keys on constraint names. RLS is on with NO policies: the table is
-- reachable only through the server-side adapter, never through the Data API.

create table pactjoy.habits (
  id uuid constraint habits_pkey primary key,
  owner_id uuid not null,
  name text not null,
  why text,
  category text,
  created_at timestamptz not null,
  version integer not null constraint habits_version_check check (version >= 0)
);

alter table pactjoy.habits enable row level security;
