import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { givenReviewWorld, logMinutes, type ReviewWorld } from "../review/review-fixtures.ts";
import {
  circleId,
  type EncouragementId,
  encouragementId,
  seasonId,
  userId,
} from "../shared/ids.ts";
import { encouragementNotice } from "./encouragement-notice.ts";
import { sendEncouragement } from "./send-encouragement.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

/** Victor encouraged Andrea after her hard first week; returns the stored encouragement's id. */
async function givenSent(): Promise<{ world: ReviewWorld; id: EncouragementId }> {
  const world = await givenReviewWorld();
  await logMinutes(world, "meditar", 0);
  await logMinutes(world, "meditar", 1);
  const sent = await sendEncouragement(world.at(9), world.victor, {
    seasonId: SEASON,
    recipientId: ANDREA,
    week: 1,
    emoji: "fire",
  });
  if (!sent.ok) throw new Error(`could not send: ${sent.error.kind}`);
  const [stored] = await world.app.encouragements.listSent(SEASON, VICTOR);
  if (!stored) throw new Error("nothing stored");
  return { world, id: stored.id };
}

const noticeOf = (world: ReviewWorld, id: EncouragementId) =>
  world.app.uow.read((repos) => encouragementNotice(repos, id));

describe("encouragementNotice (the hook job D calls to push, F17)", () => {
  it("resolves who to tell, who sent it and with what, at dispatch", async () => {
    const { world, id } = await givenSent();
    expect(await noticeOf(world, id)).toEqual({
      encouragementId: id,
      seasonId: SEASON,
      recipient: { memberId: ANDREA, userId: userId("user-andrea") },
      sender: { memberId: VICTOR, displayName: "Victor" },
      emoji: "fire",
    });
  });

  it("says nothing about the week, the habit or the consistency", async () => {
    const { world, id } = await givenSent();
    const json = JSON.stringify(await noticeOf(world, id));
    for (const word of ["caseWeek", "week", "Meditar", "consistency", "hard"]) {
      expect(json).not.toContain(word);
    }
  });

  it("is null for an encouragement that does not exist", async () => {
    const { world } = await givenSent();
    expect(await noticeOf(world, encouragementId("nope"))).toBeNull();
  });

  it("is null when the recipient is no longer in the circle (no push to someone who left)", async () => {
    const { world, id } = await givenSent();
    await world.app.uow.transaction(async (repos) => {
      const circle = await repos.circles.get(circleId("circle-1"));
      if (!circle) throw new Error("no circle");
      const members = circle.members.map((m) =>
        m.id === ANDREA ? { ...m, status: "left" as const } : m,
      );
      await repos.circles.save({ ...circle, members, version: circle.version + 1 }, circle.version);
      return { ok: true as const, value: undefined };
    });
    expect(await noticeOf(world, id)).toBeNull();
  });
});
