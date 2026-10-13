import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { ReviewRecord } from "./review.ts";

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
