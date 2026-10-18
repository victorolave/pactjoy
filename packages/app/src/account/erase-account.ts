import type { MemberId } from "@pactjoy/engine";
import { type Circle, findActiveMember } from "../circle/circle.ts";
import { eraseInviteOf, eraseMember } from "../circle/erase-member.ts";
import { leaveCircleCore } from "../circle/leave-circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { eraseMemberEncouragements } from "../encouragement/erase.ts";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import { releaseMemberPhotos } from "../entry-photo/erase.ts";
import { eraseMemberNotifications } from "../notifications/erase.ts";
import { eraseMemberPauseDetails } from "../pause/erase.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import { eraseUserRateLimits } from "../rate-limit/erase.ts";
import { eraseMemberReminders } from "../reminders/erase.ts";
import { eraseMemberReviews } from "../review/erase.ts";
import { eraseMemberClosures } from "../season/closure/erase.ts";
import type { Season } from "../season/season.ts";
import { userId as toUserId, type UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { hardDeleteCircle } from "./hard-delete-circle.ts";

export interface EraseAccountInput {
  readonly userId: UserId;
  readonly now: Instant;
  readonly timeZone: TimeZone;
  /** Mints the unlinked user id each tombstone carries. */
  readonly ids: IdGenerator;
}

/** What the transaction leaves for after the commit, plus the counts a caller may log. */
export interface ErasureOutcome {
  /** Ledger rows released inside the transaction: their objects are purged after the commit. */
  readonly released: readonly EntryPhoto[];
  /** Ledger rows dropped with a hard-deleted circle: their objects are deleted after the commit. */
  readonly dropped: readonly EntryPhoto[];
  readonly memberships: number;
  readonly circlesDeleted: number;
}

/** A circle goes entirely once every one of its members is erased, earlier leavers included (REQ-C6, C7). */
const isFullyErased = (circle: Circle): boolean =>
  circle.members.every((member) => member.erasedAt !== null);

/**
 * INSIDE the transaction (ADR-0019 E2): erases everything the person owns and tombstones every one
 * of their memberships, in the order the foreign keys and the guards allow.
 *
 * 1. Leave the active circle with today's leave semantics (`leaveCircleCore`).
 * 2. A circle whose members are ALL erased once this person is tombstoned is hard-deleted
 *    (its photo rows come back for the post-commit object delete).
 * 3. The other circles get the tombstones, then their seasons get the member's Pause details
 *    blanked and their commitments hidden (version-checked saves, `pactRevision` untouched).
 * 4. What is owned across circles goes: closures, reviews, entry evidence, photos, reminders,
 *    encouragements and dismissals, notices and devices, habits.
 *
 * Idempotent: a person already erased owns no membership, so only the user-level deletes run
 * (and find nothing).
 */
export async function eraseAccount(
  repos: Repositories,
  input: EraseAccountInput,
): Promise<ErasureOutcome> {
  const { userId, now, timeZone, ids } = input;

  const circles: Circle[] = [];
  for (const circle of await repos.circles.listByUser(userId)) {
    const active = findActiveMember(circle, userId);
    circles.push(
      active ? await leaveCircleCore(repos, { circle, member: active, now, timeZone }) : circle,
    );
  }
  const own = (circle: Circle): readonly MemberId[] =>
    circle.members.filter((m) => m.userId === userId).map((m) => m.id);
  const memberIds = circles.flatMap(own);

  const dropped: EntryPhoto[] = [];
  let circlesDeleted = 0;
  const seasons: Season[] = [];
  for (const circle of circles) {
    const mine = own(circle);
    const tombstoned = eraseInviteOf(
      {
        ...circle,
        members: circle.members.map((member) =>
          mine.includes(member.id) ? eraseMember(member, now, toUserId(ids.next())) : member,
        ),
        version: circle.version + 1,
      },
      mine,
    );
    if (isFullyErased(tombstoned)) {
      dropped.push(...(await hardDeleteCircle(repos, circle)));
      circlesDeleted += 1;
      continue;
    }
    await repos.circles.save(tombstoned, circle.version);
    for (const season of await repos.seasons.listByCircle(circle.id)) {
      await eraseMemberPauseDetails(repos, { season, circle: tombstoned, now, timeZone }, mine);
      seasons.push(season);
    }
  }

  if (memberIds.length > 0) {
    await eraseMemberClosures(repos, memberIds, seasons);
    await eraseMemberReviews(repos, memberIds);
    await repos.entries.eraseEvidence(memberIds);
    await eraseMemberReminders(repos, memberIds);
    await eraseMemberEncouragements(repos, memberIds);
  }
  const released = memberIds.length > 0 ? await releaseMemberPhotos(repos, memberIds) : [];
  await eraseUserOwned(repos, userId, memberIds);

  for (const season of seasons) {
    await hideCommitments(repos, season, memberIds);
  }
  return { released, dropped, memberships: circles.length, circlesDeleted };
}

/**
 * The user-level deletes, keyed by the ORIGINAL user id: notices addressed to the person (and to
 * their members, when given), their devices and their habits.
 */
async function eraseUserOwned(
  repos: Repositories,
  userId: UserId,
  memberIds: readonly MemberId[] = [],
): Promise<void> {
  await eraseMemberNotifications(repos, userId, memberIds);
  await repos.habits.deleteByOwner(userId);
  await eraseUserRateLimits(repos, userId);
}

/**
 * Makes the members' commitments private by a normal version-checked save (E4) and drops the one
 * free-text field of a measure, the custom unit label a person typed. Privacy and the label are not
 * scoring inputs, so points stay byte-identical, and every peer read model already renders a private
 * commitment as hidden. `pactRevision` is unchanged: the pact itself did not change.
 */
async function hideCommitments(
  repos: Pick<Repositories, "seasons">,
  season: Season,
  memberIds: readonly MemberId[],
): Promise<void> {
  const pending = season.commitments.some(
    (c) => memberIds.includes(c.memberId) && (c.privacy !== "private" || hasLabel(c.measure)),
  );
  if (!pending) return;
  await repos.seasons.save(
    {
      ...season,
      commitments: season.commitments.map((c) =>
        memberIds.includes(c.memberId)
          ? { ...c, privacy: "private" as const, measure: withoutLabel(c.measure) }
          : c,
      ),
      version: season.version + 1,
    },
    season.version,
  );
}

const hasLabel = (measure: Measure): boolean =>
  measure.unit !== "done" && measure.customLabel !== null;

const withoutLabel = (measure: Measure): Measure =>
  measure.unit === "done" ? measure : { ...measure, customLabel: null };
