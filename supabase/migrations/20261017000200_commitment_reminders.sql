-- PactJoy persistence, commitment reminders (ADR-0017 addendum, change
-- `commitment-reminders`, roadmap D2).
--
-- One row per commitment of a season: its owner's reminder setting. It is its own
-- small aggregate with its own `version`, so changing it never touches the pact
-- (`pact_revision`, `seasons.version`, approvals) nor any scoring input. A
-- commitment never configured has no row; the application shows the default (off,
-- 20:00, every day the commitment can fire).
--
--   minute_of_day  season-local, 08:00-21:45 on a 15-minute grid, so the hour a
--                  reminder stays valid ends by the 22:00 quiet hours
--   weekdays       bitmask of engine weekdays (bit 0 = Sunday ... bit 6 = Saturday)
--
-- There is NO foreign key (like the notification tables): a pact-open season can be
-- discarded and commitments are replaced wholesale by the season's save; the
-- planner skips a reminder whose season or commitment is gone. Account deletion
-- (change E) deletes by `member_id`. There are NO triggers and NO SQL functions:
-- which days a commitment may be reminded on is checked by the application.
--
-- RLS is on with NO policies and the client roles are revoked. Additive and
-- forward-only: rollback is dropping the table.

create table pactjoy.commitment_reminders (
  season_id uuid not null,
  commitment_id uuid not null,
  member_id uuid not null,
  enabled boolean not null,
  minute_of_day smallint not null
    constraint commitment_reminders_minute_of_day_check
      check (minute_of_day between 480 and 1305 and minute_of_day % 15 = 0),
  weekdays smallint not null
    constraint commitment_reminders_weekdays_check check (weekdays between 0 and 127),
  updated_at timestamptz not null,
  version integer not null constraint commitment_reminders_version_check check (version >= 1),
  constraint commitment_reminders_pkey primary key (season_id, commitment_id),
  constraint commitment_reminders_enabled_weekdays_check check (not enabled or weekdays > 0)
);

create index commitment_reminders_member_id_idx on pactjoy.commitment_reminders (member_id);

alter table pactjoy.commitment_reminders enable row level security;

revoke all on pactjoy.commitment_reminders from public, anon, authenticated;
