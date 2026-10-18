import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { ReviewRecord } from "./review.ts";

/** Test assertion: the member's persisted reviews of the season, as the store holds them. */
export function storedReviews(
  app: { readonly uow: UnitOfWork<Repositories> },
  seasonId: SeasonId,
  memberId: MemberId,
): Promise<readonly ReviewRecord[]> {
  return app.uow.read((repos) => repos.reviews.listMine(seasonId, memberId));
}

/** Test setup: stores a review straight to the store, bypassing the use cases (GIVEN state). */
export async function seedReview(
  app: { readonly uow: UnitOfWork<Repositories> },
  record: ReviewRecord,
): Promise<void> {
  await app.uow.transaction(async (repos) => {
    await repos.reviews.save(record, null);
    return { ok: true as const, value: undefined };
  });
}
