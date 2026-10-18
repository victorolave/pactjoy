-- PactJoy: the encouragement push (ADR-0018 F17, change `social-reactions`).
--
-- Adds `encouragementNudge` to the closed list of notification kinds, as
-- `NotificationKind` does (ADR-0017: adding a kind is a new migration). The row is
-- enqueued by `sendEncouragement` in its own transaction, to the recipient only, with
-- ids only in `params` (`seasonId`, `encouragementId`): never the week, the habit, the
-- consistency, the sender or the emoji.
--
-- Only the representational CHECK changes; no trigger, no function, no data change.
-- Rollback: a forward migration restoring the previous list, after deleting any
-- `encouragementNudge` rows.

alter table pactjoy.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check (kind in (
    'pauseRequested', 'pauseApproved', 'pauseRejected', 'pauseEndsTomorrow',
    'pactPendingApproval', 'seasonStarted', 'reviewDue', 'seasonClosed',
    'encouragementNudge'
  ));
