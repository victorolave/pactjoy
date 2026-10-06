-- PactJoy: an optional icon key per habit (change pwa-season-habits-pact, HB-R1).
--
-- The column is an opaque key such as `book-open`; the closed list of valid keys
-- lives in the web client (like `category`), so swapping the icon set never needs
-- a migration. The check enforces FORMAT only, mirroring the app's rule: lowercase
-- kebab-case, starting with a letter, at most 32 characters. Null means "no icon".
--
-- Additive and nullable: existing rows stay valid with no backfill.
--
-- Rollback: a forward migration `..._drop_habits_icon.sql`
-- (`alter table pactjoy.habits drop column icon`), or a dev reset.
-- Drop habits_owner_created_at_idx separately if also rolling back the list index.
-- No grant is needed: the table-level privileges were revoked in 000500.

alter table pactjoy.habits
  add column icon text
  constraint habits_icon_check check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,31}$');

-- Matches listByOwner's filter and deterministic newest-first order.
create index habits_owner_created_at_idx on pactjoy.habits (owner_id, created_at desc, id);
