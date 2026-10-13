-- PactJoy: habit graduation (change season-close-graduation, REQ-G1).
--
-- `graduated_at` is the instant the owner graduated the habit while closing a
-- season; null means the habit is still tracked. It is written only by the
-- closure use case (application code), never derived here: no trigger, no
-- default, no backfill. Graduation is permanent, but that rule lives in the app.
--
-- Additive and nullable: existing rows stay valid.
--
-- Rollback: a forward migration `..._drop_habits_graduated_at.sql`
-- (`alter table pactjoy.habits drop column graduated_at`), or a dev reset.
-- No grant is needed: the table-level privileges were revoked in 000500.

alter table pactjoy.habits add column graduated_at timestamptz;
