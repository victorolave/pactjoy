import type { MemberId } from "@pactjoy/engine";
import { type SeasonId, seasonClosureId } from "../../shared/ids.ts";
import { ok } from "../../shared/result.ts";
import type { TestApp } from "../../testing/app-harness.ts";
import { seasonClosureFixture } from "../../testing/builders.ts";
import type { SeasonClosure } from "./season-closure.ts";

/**
 * GIVEN-state helpers for tests OUTSIDE this folder. The closure store is confined to
 * `src/season/closure/` (`closure-guard.test.ts`), so a test that needs closures to exist, or to
 * look one up, goes through here instead of touching `repos.seasonClosures` itself.
 */

/** Stores a closure of `seasonId` by each member, bypassing the use cases (no decisions). */
export async function givenClosures(
  app: TestApp,
  seasonId: SeasonId,
  members: readonly MemberId[],
  decisions: SeasonClosure["decisions"] = [],
): Promise<void> {
  await app.uow.transaction(async (repos) => {
    for (const member of members) {
      await repos.seasonClosures.save(
        seasonClosureFixture({
          id: seasonClosureId(`closure-${seasonId}-${member}`),
          seasonId,
          memberId: member,
          decisions,
        }),
        null,
      );
    }
    return ok(undefined);
  });
}

/** Reads one member's stored closure, bypassing the use cases (for assertions). */
export function storedClosure(
  app: TestApp,
  seasonId: SeasonId,
  member: MemberId,
): Promise<SeasonClosure | null> {
  return app.uow.read((repos) => repos.seasonClosures.getMine(seasonId, member));
}

/** The members who have a stored closure of the season (for assertions). */
export function storedClosedIds(app: TestApp, seasonId: SeasonId): Promise<readonly MemberId[]> {
  return app.uow.read((repos) => repos.seasonClosures.closedMemberIds(seasonId));
}
