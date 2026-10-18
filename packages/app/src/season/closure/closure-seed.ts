import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../../ports/repositories.ts";
import type { UnitOfWork } from "../../ports/unit-of-work.ts";
import type { SeasonId } from "../../shared/ids.ts";
import type { SeasonClosure } from "./season-closure.ts";

/** Test assertion: the member's persisted closure of the season, or `null`. */
export function storedClosure(
  app: { readonly uow: UnitOfWork<Repositories> },
  seasonId: SeasonId,
  memberId: MemberId,
): Promise<SeasonClosure | null> {
  return app.uow.read((repos) => repos.seasonClosures.getMine(seasonId, memberId));
}

/** Test setup: stores a closure straight to the store, bypassing the use cases (GIVEN state). */
export async function seedClosure(
  app: { readonly uow: UnitOfWork<Repositories> },
  closure: SeasonClosure,
): Promise<void> {
  await app.uow.transaction(async (repos) => {
    await repos.seasonClosures.save(closure, null);
    return { ok: true as const, value: undefined };
  });
}
