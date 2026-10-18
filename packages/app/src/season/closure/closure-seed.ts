import type { Repositories } from "../../ports/repositories.ts";
import type { UnitOfWork } from "../../ports/unit-of-work.ts";
import type { SeasonClosure } from "./season-closure.ts";

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
