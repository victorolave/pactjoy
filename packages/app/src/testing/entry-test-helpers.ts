import { expect } from "vitest";
import type { Season } from "../season/season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { TestApp } from "./app-harness.ts";

/** Commits a season change (one version ahead) as if someone else had made it. */
export function changeSeason(app: TestApp, season: Season, change: Partial<Season> = {}) {
  return app.uow.transaction(async (repos) => {
    await repos.seasons.save({ ...season, ...change, version: season.version + 1 }, season.version);
    return { ok: true as const, value: undefined };
  });
}

/** Asserts a `raceTransactions` side rejected with `ConcurrencyConflict`. */
export function expectConflict(result: PromiseSettledResult<unknown>): void {
  expect(result.status).toBe("rejected");
  expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
}
