-- PactJoy persistence, the social layer (ADR-0018, change `social-reactions`).
--
-- The circle activity feed is DERIVED on every read from entries, pauses and seasons; nothing
-- about the feed is stored. Three small aggregates are:
--
--   feed_reactions    a member's one Reaction to one feed item, named by its stable item key
--   encouragements    a Sugerencia de animo one member sent another (insert-only)
--   nudge_dismissals  "Ahora no": a viewer hid one nudge case for good (insert-once)
--
-- Unique keys that are atomic with the write (a lost race raises 23505, which the unit of work
-- maps to ConcurrencyConflict):
--
--   feed_reactions_season_item_member_key  (season_id, item_key, member_id)
--   encouragements_case_key                (season_id, sender, recipient, case_week)
--   encouragements_daily_key               (sender, recipient, sent_on)
--
-- A dismissal is the exception: the port is idempotent, so the repository inserts it with
-- ON CONFLICT DO NOTHING and the primary key never surfaces as an error.
--
-- There are NO triggers and NO SQL functions: only representational CHECKs (value sets, ranges,
-- the shape of a key). Which items exist, who may react, which nudge is live and the daily rule
-- stay in the application.
--
-- The only foreign key from each table is to the season ROOT, RESTRICT: rows exist only for
-- started seasons, and only a never-started season is ever deleted. There is none to a member or
-- to a commitment (children of a season are replaced wholesale on every save), and nothing
-- references these tables.
--
-- ACCOUNT DELETION (job E). The per-member columns, which job E deletes or anonymizes
-- (reactions as "miembro que salio", encouragements and dismissals deleted), are:
--
--   feed_reactions.member_id
--   encouragements.sender_member_id
--   encouragements.recipient_member_id
--   nudge_dismissals.viewer_member_id
--   nudge_dismissals.target_member_id
--
-- Encouragements and dismissals are private to their owners: the application's ports have no
-- season-wide read of them. RLS is on with NO policies, with the client roles revoked. Additive
-- and forward-only: rollback is dropping the three tables.

create table pactjoy.feed_reactions (
  id uuid constraint feed_reactions_pkey primary key,
  season_id uuid not null
    constraint feed_reactions_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  -- The stable key of a derived feed item (`session:<commitment>:<day>`, `week:<commitment>:<week>`,
  -- `pause:<id>`, ...): lowercase kind, then ':'-separated segments of ids or numbers.
  item_key text not null
    constraint feed_reactions_item_key_check
      check (length(item_key) <= 120 and item_key ~ '^[a-z-]+(:[0-9A-Za-z-]+)+$'),
  member_id uuid not null,
  emoji text not null
    constraint feed_reactions_emoji_check check (emoji in ('heart', 'raisedHands', 'fire', 'clap')),
  reacted_at timestamptz not null,
  version integer not null constraint feed_reactions_version_check check (version >= 0),
  -- Also serves the season-wide read: `season_id` is its leading column.
  constraint feed_reactions_season_item_member_key unique (season_id, item_key, member_id)
);

alter table pactjoy.feed_reactions enable row level security;

create table pactjoy.encouragements (
  id uuid constraint encouragements_pkey primary key,
  season_id uuid not null
    constraint encouragements_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  sender_member_id uuid not null,
  recipient_member_id uuid not null,
  case_week integer not null
    constraint encouragements_case_week_check check (case_week between 1 and 12),
  emoji text not null
    constraint encouragements_emoji_check check (emoji in ('heart', 'raisedHands', 'fire', 'clap')),
  sent_at timestamptz not null,
  -- The civil day in the season's time zone: what the one-per-person-per-day rule compares.
  sent_on date not null,
  constraint encouragements_sender_recipient_check check (sender_member_id <> recipient_member_id),
  constraint encouragements_case_key
    unique (season_id, sender_member_id, recipient_member_id, case_week),
  constraint encouragements_daily_key unique (sender_member_id, recipient_member_id, sent_on)
);

-- The recipient's reads ("X te envio ...").
create index encouragements_season_recipient_idx
  on pactjoy.encouragements (season_id, recipient_member_id);

alter table pactjoy.encouragements enable row level security;

create table pactjoy.nudge_dismissals (
  season_id uuid not null
    constraint nudge_dismissals_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  viewer_member_id uuid not null,
  target_member_id uuid not null,
  case_week integer not null
    constraint nudge_dismissals_case_week_check check (case_week between 1 and 12),
  dismissed_at timestamptz not null,
  dismissed_on date not null,
  constraint nudge_dismissals_pkey
    primary key (season_id, viewer_member_id, target_member_id, case_week)
);

alter table pactjoy.nudge_dismissals enable row level security;

revoke all on pactjoy.feed_reactions, pactjoy.encouragements, pactjoy.nudge_dismissals
  from public, anon, authenticated;
