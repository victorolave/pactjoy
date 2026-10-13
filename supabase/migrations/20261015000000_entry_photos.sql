-- PactJoy persistence, photo evidence (ADR-0016, change `photo-evidence`).
--
-- `entry_photos` is the UPLOAD LEDGER: one row per reserved photo, from the signed
-- upload to the Entry that owns it. An Entry only carries `entries.photo_id`; the
-- object key and the reservation state live here and never reach a peer.
--
--   pending   reserved; the browser may still PUT the object until `attach_by`
--   attached  owned by exactly one Entry
--   released  nobody owns it; the object is deleted (or about to be), then the row is purged
--
-- A save changes `status` and `version` only, never a key column, so it takes the
-- lightest row lock (FOR NO KEY UPDATE) and does not block the KEY SHARE that
-- the `entries.photo_id` foreign key takes on this table (ADR-0010).
--
-- There are NO triggers and NO SQL functions: only representational CHECKs (value
-- sets, ranges, the shape of a key). Who may reserve, how many pending rows a member
-- may hold, what a missed Entry may carry and when a row expires stay in the
-- application.
--
-- `entry_photos.season_id` is a foreign key to the season ROOT, RESTRICT. There is
-- none to a member or a commitment (children of a season are replaced wholesale).
-- `entries.photo_id` is RESTRICT too: a purge can never orphan an Entry, because the
-- application releases the photo in the same transaction that clears or replaces it.
-- `entries_photo_id_key` makes one photo belong to one Entry; the loser of a double
-- attach gets 23505, which the unit of work maps to ConcurrencyConflict. A tombstone
-- keeps no photo.
--
-- RLS is on with NO policies and the client roles are revoked: the table is reachable
-- only through the application. Additive and forward-only: rollback is dropping
-- `entries.photo_id` (and its two constraints), then the table.

create table pactjoy.entry_photos (
  id uuid constraint entry_photos_pkey primary key,
  season_id uuid not null
    constraint entry_photos_season_id_fkey references pactjoy.seasons (id) on delete restrict,
  member_id uuid not null,
  commitment_id uuid not null,
  -- Opaque and minted by the application: `o/` + 32 lowercase hex + `.jpg`.
  object_key text not null
    constraint entry_photos_object_key_check check (object_key ~ '^o/[0-9a-f]{32}\.jpg$'),
  -- The exact size the signed upload pins: 1 byte to 3 MiB.
  byte_size integer not null
    constraint entry_photos_byte_size_check check (byte_size between 1 and 3145728),
  content_type text not null default 'image/jpeg'
    constraint entry_photos_content_type_check check (content_type = 'image/jpeg'),
  status text not null
    constraint entry_photos_status_check check (status in ('pending', 'attached', 'released')),
  created_at timestamptz not null,
  attach_by timestamptz not null,
  version integer not null constraint entry_photos_version_check check (version >= 0),
  constraint entry_photos_object_key_key unique (object_key),
  constraint entry_photos_attach_by_check check (attach_by > created_at)
);

-- The per-member cap and the member-scoped sweep.
create index entry_photos_member_status_idx on pactjoy.entry_photos (member_id, status);
-- The global sweep: expired pending rows, released rows.
create index entry_photos_status_attach_by_idx on pactjoy.entry_photos (status, attach_by);

alter table pactjoy.entries
  add column photo_id uuid
    constraint entries_photo_id_fkey references pactjoy.entry_photos (id) on delete restrict
    constraint entries_photo_id_key unique,
  add constraint entries_photo_shape check (not deleted or photo_id is null);

alter table pactjoy.entry_photos enable row level security;

revoke all on pactjoy.entry_photos from public, anon, authenticated;
