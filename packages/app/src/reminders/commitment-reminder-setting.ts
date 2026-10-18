import type { CommitmentId, Weekday } from "@pactjoy/engine";
import { type Circle, findActiveMember, type Member } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import {
  type CommitmentReminder,
  defaultReminderSetting,
  type InvalidReminderReason,
  invalidReminderReason,
  type ReminderSetting,
  reminderDaysOf,
} from "./commitment-reminder.ts";

export interface CommitmentReminderInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
}

/** What the owner sees: the setting (stored, or the default) and the days it may use. */
export interface CommitmentReminderView extends ReminderSetting {
  readonly commitmentId: CommitmentId;
  /** The days this commitment can be reminded on (its own days for `specificDays`, else all). */
  readonly availableWeekdays: readonly Weekday[];
}

export type CommitmentReminderError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "CommitmentNotFound" };

export type SetCommitmentReminderError =
  | CommitmentReminderError
  | { readonly kind: "SeasonClosed" }
  | { readonly kind: "HabitGraduated" }
  | { readonly kind: "InvalidReminder"; readonly reason: InvalidReminderReason };

export type SetCommitmentReminderInput = CommitmentReminderInput & ReminderSetting;

export interface GetCommitmentReminderDeps {
  readonly uow: Pick<UnitOfWork<Repositories>, "read">;
}

export interface SetCommitmentReminderDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
}

interface Owned {
  readonly season: Season;
  readonly circle: Circle;
  readonly member: Member;
  readonly commitment: CommitmentRecord;
  readonly stored: CommitmentReminder | null;
}

/**
 * The asking member's own commitment and its stored reminder. The actor is always the owner (no
 * member id comes from a request), so another member's reminder cannot be addressed: their
 * commitment is `CommitmentNotFound`, like an unknown one (REQ-R1, SC-R8).
 */
async function loadOwned(
  repos: Repositories,
  actor: Actor,
  input: CommitmentReminderInput,
): Promise<Result<Owned, CommitmentReminderError>> {
  const season = await repos.seasons.get(input.seasonId);
  if (!season) return err({ kind: "SeasonNotFound" });
  const circle = await repos.circles.get(season.circleId);
  const member = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!circle || !member) return err({ kind: "NotAMember" });
  const commitment = season.commitments.find(
    (c) => c.id === input.commitmentId && c.memberId === member.id,
  );
  if (!commitment) return err({ kind: "CommitmentNotFound" });
  const stored = await repos.reminders.get(season.id, commitment.id);
  return ok({ season, circle, member, commitment, stored });
}

function viewOf(commitment: CommitmentRecord, setting: ReminderSetting): CommitmentReminderView {
  return {
    commitmentId: commitment.id,
    enabled: setting.enabled,
    minuteOfDay: setting.minuteOfDay,
    weekdays: setting.weekdays,
    availableWeekdays: reminderDaysOf(commitment),
  };
}

const settingOf = (reminder: CommitmentReminder): ReminderSetting => ({
  enabled: reminder.enabled,
  minuteOfDay: reminder.minuteOfDay,
  weekdays: reminder.weekdays,
});

/**
 * The stored setting as the owner sees it today: if the commitment's days changed since it was
 * saved (an edit keeps the commitment id), only the days it still has, or all of them when none is
 * left, so whatever the owner sends back is valid. The planner never fires on a day without a
 * session anyway (`reminder-notices.ts`).
 */
function shownSetting(reminder: CommitmentReminder, commitment: CommitmentRecord): ReminderSetting {
  const allowed = reminderDaysOf(commitment);
  const kept = reminder.weekdays.filter((day) => allowed.includes(day));
  return { ...settingOf(reminder), weekdays: kept.length > 0 ? kept : allowed };
}

const sameSetting = (a: ReminderSetting, b: ReminderSetting) =>
  a.enabled === b.enabled &&
  a.minuteOfDay === b.minuteOfDay &&
  a.weekdays.length === b.weekdays.length &&
  a.weekdays.every((day, i) => day === b.weekdays[i]);

/** The owner's reminder for one of their commitments, or the default if never saved (REQ-R1). */
export async function getCommitmentReminder(
  deps: GetCommitmentReminderDeps,
  actor: Actor,
  input: CommitmentReminderInput,
): Promise<Result<CommitmentReminderView, CommitmentReminderError>> {
  return deps.uow.read(async (repos) => {
    const owned = await loadOwned(repos, actor, input);
    if (!owned.ok) return owned;
    const { commitment, stored } = owned.value;
    return ok(
      viewOf(
        commitment,
        stored ? shownSetting(stored, commitment) : defaultReminderSetting(commitment),
      ),
    );
  });
}

/**
 * Saves the owner's reminder for one of their commitments (REQ-R1..R4). It is a personal setting,
 * not part of the pact: it may change while the pact is open or the season runs, and it never
 * touches `pactRevision`, `season.version` or the approvals (REQ-R2, SC-R9). Idempotent: the same
 * setting twice stores one version. Refuses a closed season, an invalid setting (REQ-R3) and
 * turning on, or moving, the reminder of a habit already graduated; turning one off always works.
 */
export async function setCommitmentReminder(
  deps: SetCommitmentReminderDeps,
  actor: Actor,
  input: SetCommitmentReminderInput,
): Promise<Result<CommitmentReminderView, SetCommitmentReminderError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<CommitmentReminderView, SetCommitmentReminderError>> => {
      const owned = await loadOwned(repos, actor, input);
      if (!owned.ok) return owned;
      const { season, member, commitment, stored } = owned.value;
      if (season.status === "closed") return err({ kind: "SeasonClosed" });
      const reason = invalidReminderReason(input, commitment);
      if (reason !== null) return err({ kind: "InvalidReminder", reason });

      const setting: ReminderSetting = {
        enabled: input.enabled,
        minuteOfDay: input.minuteOfDay,
        weekdays: [...input.weekdays].sort((a, b) => a - b),
      };
      if (stored && sameSetting(settingOf(stored), setting)) return ok(viewOf(commitment, setting));
      if (setting.enabled) {
        const [habit] = await repos.habits.getMany([commitment.habitId]);
        if (habit?.graduatedAt != null) return err({ kind: "HabitGraduated" });
      }
      await repos.reminders.save(
        {
          seasonId: season.id,
          commitmentId: commitment.id,
          memberId: member.id,
          ...setting,
          updatedAt: deps.clock.now(),
          version: (stored?.version ?? 0) + 1,
        },
        stored?.version ?? null,
      );
      return ok(viewOf(commitment, setting));
    },
  );
}
