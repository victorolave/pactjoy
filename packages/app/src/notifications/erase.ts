import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { CircleId, UserId } from "../shared/ids.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019): deletes every notice addressed to the person
 * (by the ORIGINAL user id and by their members, in any state) and every device they registered.
 * Notices to peers are left alone: their params are ids only (REQ-K1), so none carries anything of
 * the erased member, and a pause or encouragement id they point to is gone or blanked by the same
 * erasure, which `relevanceOf` already drops at dispatch. Lives here because `repos.notifications`
 * and `repos.pushSubscriptions` are confined to this module (`notification-guard.test.ts`).
 */
export async function eraseMemberNotifications(
  repos: Pick<Repositories, "notifications" | "pushSubscriptions">,
  userId: UserId,
  memberIds: readonly MemberId[],
): Promise<void> {
  await repos.notifications.deleteAddressedTo(userId, memberIds);
  await repos.pushSubscriptions.removeAllOfUser(userId);
}

/**
 * INSIDE the transaction (a fully erased circle): deletes every notice of the circles, whoever
 * received it. Devices are the account's, not the circle's, so they stay.
 */
export async function dropCircleNotifications(
  repos: Pick<Repositories, "notifications">,
  circleIds: readonly CircleId[],
): Promise<void> {
  await repos.notifications.deleteByCircles(circleIds);
}
