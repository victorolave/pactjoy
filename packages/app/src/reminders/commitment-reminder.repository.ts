import type { CommitmentId } from "@pactjoy/engine";
import type { SeasonId } from "../shared/ids.ts";
import type { CommitmentReminder } from "./commitment-reminder.ts";

/**
 * Storage port of the commitment reminders (ADR-0017 addendum, D2). One row per commitment of a
 * season. Confined to `src/reminders/` (`reminder-guard.test.ts`): a reminder is its owner's alone.
 */
export interface CommitmentReminderRepository {
  /** The setting stored for the commitment, or `null` if its owner never saved one. */
  get(seasonId: SeasonId, commitmentId: CommitmentId): Promise<CommitmentReminder | null>;
  /** The season's ENABLED reminders, by commitment id: what the planner may owe a push for. */
  listEnabled(seasonId: SeasonId): Promise<readonly CommitmentReminder[]>;
  /**
   * Inserts (`expectedVersion` null) or updates the setting.
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion`, or,
   * for an insert, the commitment already has one.
   */
  save(reminder: CommitmentReminder, expectedVersion: number | null): Promise<void>;
}
