import { describe, expect, it } from "vitest";
import { givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { givenClosures } from "../season/closure/closure-fixtures.ts";
import { circleId, seasonId, userId } from "../shared/ids.ts";
import { joinCircleInput } from "../testing/circle-inputs.ts";
import { memberId } from "./circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { previewInvite } from "./preview-invite.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const JOINER = { userId: userId("user-joiner") };
const SEASON = seasonId("season-1");

/** A world whose latest season is ACTIVE; `n` is the 1-based season day the clock reads. */
async function given(n: number, closed: readonly (typeof ANDREA)[] = []) {
  const world = await givenReviewWorld({ lengthWeeks: 4 });
  await givenClosures(world.app, SEASON, closed);
  const app = world.at(n);
  const invite = await generateInvite(app, world.andrea, { circleId: circleId("circle-1") });
  if (!invite.ok) throw new Error("invite failed");
  return { world, app, code: invite.value.code };
}

const latest = (world: ReviewWorld) =>
  world.app.uow.read((repos) => repos.seasons.findLatestByCircle(circleId("circle-1")));

describe("joining a circle whose season has ended (REQ-F11)", () => {
  it("mid-season the season still blocks the join and the preview", async () => {
    const { app, code } = await given(10);
    expect(await joinCircle(app, JOINER, joinCircleInput(code))).toEqual({
      ok: false,
      error: { kind: "SeasonNotJoinable" },
    });
    expect(await previewInvite(app, JOINER, { inviteCode: code })).toEqual({
      ok: false,
      error: { kind: "SeasonNotJoinable" },
    });
  });

  it("ended but a participant is still to close and it is not yet stale: still blocked", async () => {
    for (const n of [29, 30, 35]) {
      const { app, code } = await given(n, [ANDREA]);
      expect(await joinCircle(app, JOINER, joinCircleInput(code))).toEqual({
        ok: false,
        error: { kind: "SeasonNotJoinable" },
      });
    }
  });

  it("everyone closed on the results day: joinable, and the preview stays read-only", async () => {
    const { world, app, code } = await given(30, [ANDREA, VICTOR]);

    const preview = await previewInvite(app, JOINER, { inviteCode: code });
    expect(preview.ok).toBe(true);
    expect(await latest(world)).toMatchObject({ status: "active", version: 0 });

    const joined = await joinCircle(app, JOINER, joinCircleInput(code));
    expect(joined.ok).toBe(true);
    expect(await latest(world)).toMatchObject({ status: "closed", version: 1 });
  });

  it("a week after the end the laggard is cut off: the join succeeds and finalizes the season", async () => {
    const { world, app, code } = await given(36, [ANDREA]);
    expect((await previewInvite(app, JOINER, { inviteCode: code })).ok).toBe(true);
    expect(await latest(world)).toMatchObject({ status: "active" });

    expect((await joinCircle(app, JOINER, joinCircleInput(code))).ok).toBe(true);
    expect(await latest(world)).toMatchObject({ status: "closed", version: 1 });
  });
});
