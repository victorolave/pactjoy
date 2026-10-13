import { describe, expect, it } from "vitest";
import { givenReviewWorld } from "../review/review-fixtures.ts";
import { givenClosures } from "../season/closure/closure-fixtures.ts";
import { circleId, seasonId } from "../shared/ids.ts";
import { memberId } from "./circle.ts";
import { leaveCircle } from "./leave-circle.ts";

const ANDREA = memberId("member-andrea");
const SEASON = seasonId("season-1");
const CIRCLE = circleId("circle-1");

async function given(n: number, closed: readonly (typeof ANDREA)[]) {
  const world = await givenReviewWorld({ lengthWeeks: 4 });
  await givenClosures(world.app, SEASON, closed);
  const season = () => world.app.uow.read((repos) => repos.seasons.findLatestByCircle(CIRCLE));
  return { world, app: world.at(n), season };
}

describe("leaveCircle in the ended phase (SC-F3)", () => {
  it("the leave that completes the set finalizes the season", async () => {
    const { world, app, season } = await given(30, [ANDREA]);
    // Victor is the only participant still to close; he leaves.
    const result = await leaveCircle(app, world.victor, { circleId: CIRCLE });
    expect(result.ok).toBe(true);
    expect(await season()).toMatchObject({ status: "closed", version: 1 });
  });

  it("a leave that leaves someone still to close does not finalize", async () => {
    const { world, app, season } = await given(30, [ANDREA]);
    // Andrea already closed; leaving does not complete anything: Victor is still to close.
    const result = await leaveCircle(app, world.andrea, { circleId: CIRCLE });
    expect(result.ok).toBe(true);
    expect(await season()).toMatchObject({ status: "active", version: 0 });
  });

  it("the grace day never finalizes, even if the set is complete", async () => {
    const { world, app, season } = await given(29, [ANDREA]);
    await leaveCircle(app, world.victor, { circleId: CIRCLE });
    expect(await season()).toMatchObject({ status: "active", version: 0 });
  });

  it("stale does not finalize on a leave (only opening the next season does)", async () => {
    const { world, app, season } = await given(36, []);
    await leaveCircle(app, world.victor, { circleId: CIRCLE });
    expect(await season()).toMatchObject({ status: "active", version: 0 });
  });

  it("mid-season a leave leaves the season untouched", async () => {
    const { world, app, season } = await given(10, [ANDREA]);
    await leaveCircle(app, world.victor, { circleId: CIRCLE });
    expect(await season()).toMatchObject({ status: "active", version: 0 });
  });
});
