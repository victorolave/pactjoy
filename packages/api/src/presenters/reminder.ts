import type { CommitmentReminderView } from "@pactjoy/app";

/** The owner's reminder setting, field by field (nothing else of the stored row leaves the API). */
export function presentCommitmentReminder(view: CommitmentReminderView) {
  return {
    commitmentId: view.commitmentId,
    enabled: view.enabled,
    minuteOfDay: view.minuteOfDay,
    weekdays: [...view.weekdays],
    availableWeekdays: [...view.availableWeekdays],
  };
}
