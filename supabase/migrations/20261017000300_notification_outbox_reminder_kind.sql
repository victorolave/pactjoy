-- PactJoy persistence, the commitment reminder notice (ADR-0017 addendum, change
-- `commitment-reminders`, roadmap D2).
--
-- Adds `commitmentReminder` to the closed list of notice kinds. The list mirrors
-- `NotificationKind` in packages/app: adding a kind is a new migration that
-- replaces this representational CHECK (no trigger, no SQL function). Forward-only.

alter table pactjoy.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check (kind in (
    'pauseRequested', 'pauseApproved', 'pauseRejected', 'pauseEndsTomorrow',
    'pactPendingApproval', 'seasonStarted', 'reviewDue', 'seasonClosed',
    'commitmentReminder'
  ));
