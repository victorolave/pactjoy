import { memberId } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { circleFixture, habitFixture, memberFixture, seasonFixture } from "../testing/builders.ts";

/**
 * What every contract suite needs from an adapter. Suites drive it ONLY
 * through `uow.transaction` / `uow.read` (never an adapter's own
 * transaction API), so the same suite runs on any adapter. `UnitOfWork` is
 * covariant in its repositories, so the full bag satisfies any `Pick`.
 *
 * A factory over a real database MUST provide a pool of at least 2
 * connections: the guard cases hold one transaction open while another
 * runs, so a single connection would deadlock the suite.
 */
export interface ContractSubject<R> {
  readonly uow: UnitOfWork<R>;
}

export type GuardRepositories = Pick<Repositories, "circles" | "seasons">;

/**
 * The single source of ids for the suites. They are valid uuids, because
 * the Postgres columns are `uuid`, and readable enough for the in-memory
 * adapters too.
 */
export const CIRCLE = circleFixture({
  id: circleId("00000000-0000-4000-8000-0000000000c1"),
  members: [
    memberFixture({
      id: memberId("00000000-0000-4000-8000-0000000000a1"),
      userId: userId("00000000-0000-4000-8000-0000000000b1"),
    }),
  ],
});

export const SEASON = seasonFixture({
  id: seasonId("00000000-0000-4000-8000-0000000000e1"),
  circleId: CIRCLE.id,
});

export type HabitRepositories = Pick<Repositories, "habits">;

export const HABIT = habitFixture({
  id: habitId("00000000-0000-4000-8000-0000000000d1"),
  ownerId: userId("00000000-0000-4000-8000-0000000000b1"),
});

/** Saves the circle, then the season, in one transaction: parents first, for the foreign keys. */
export async function seedCircleAndSeason(uow: UnitOfWork<GuardRepositories>): Promise<void> {
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(SEASON, null);
    return ok(undefined);
  });
}
