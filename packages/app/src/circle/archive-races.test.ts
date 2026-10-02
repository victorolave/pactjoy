import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { joinCircleInput } from "../testing/circle-inputs.ts";
import { givenSoloOpenPact } from "../testing/pact-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { instant } from "../time/instant.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { leaveCircle } from "./leave-circle.ts";

// Noon UTC keeps the local calendar date stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

function expectConflict(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe("rejected");
  expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
}

describe("circle archive races (deterministic, D5)", () => {
  it("the last member's leave commits first: the circle is archived and the concurrent join is rejected without a trace", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, andrea, { circleId: circle.id }),
      (a) => joinCircle(a, carla, joinCircleInput(invite.value.code)),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await app.circles.get(circle.id);
    expect(stored?.archivedAt).not.toBeNull();
    expect(stored?.members.map((m) => m.userId)).toEqual([andrea.userId]);
    expect(await app.seasons.get(season.id)).toBeNull();
  });

  it("the join commits first: the circle is not archived and the last member's leave is rejected without a trace", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => joinCircle(a, carla, joinCircleInput(invite.value.code)),
      (a) => leaveCircle(a, andrea, { circleId: circle.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await app.circles.get(circle.id);
    expect(stored?.archivedAt).toBeNull();
    expect(stored?.members.map((m) => [m.userId, m.status])).toEqual([
      [andrea.userId, "active"],
      [carla.userId, "active"],
    ]);
    // The joiner's approval reset bumped the season once; the loser's delete never landed.
    expect((await app.seasons.get(season.id))?.version).toBe(season.version + 1);
  });
});
