import { describe, expect, it } from "vitest";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { givenOpenPactWithOneApproval, storedSeason } from "../testing/pact-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

function expectConflict(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe("rejected");
  expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
}

describe("pact approval races (deterministic, D5)", () => {
  it("closing approval commits first: a join that read the open pact is rejected and the circle is untouched", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => approvePact(a, victor, { seasonId: season.id }),
      (a) => joinCircle(a, carla, { inviteCode: invite.value.code }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect((await storedSeason(app, season.id)).status).toBe("active");
    const storedCircle = await app.uow.read((repos) => repos.circles.get(circle.id));
    expect(storedCircle?.members.some((m) => m.userId === carla.userId)).toBe(false);
  });
});
