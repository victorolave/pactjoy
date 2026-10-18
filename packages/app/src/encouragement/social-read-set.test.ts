import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { circleFeed } from "../feed/circle-feed.query.ts";
import { reactToFeedItem } from "../reaction/react-to-feed-item.ts";
import { removeFeedReaction } from "../reaction/remove-feed-reaction.ts";
import { givenReviewWorld, logMinutes, type ReviewWorld } from "../review/review-fixtures.ts";
import {
  answerClosingReview,
  decideAll,
  SEASON,
  submitClosureAs,
} from "../season/closure/closure-world.ts";
import { submitSeasonClosure } from "../season/closure/submit-season-closure.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId } from "../shared/ids.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { dismissNudge } from "./dismiss-nudge.ts";
import { sendEncouragement } from "./send-encouragement.ts";

/**
 * Social writes carry the same read-set guard as `recordEntry` (D5): what they decided from (the
 * actor's membership, the owner's, the season's state) must still hold at commit. Each race below
 * pauses both transactions after their first circle read, lets the winner commit, then the loser
 * commits against a stale view: it must fail with `ConcurrencyConflict` and store nothing.
 */
const SESSION = "session:commitment-meditar:1";
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const CIRCLE = circleId("circle-1");
const DAY = 9;

/** Andrea kept 2 of 7 sessions in week 1 (a hard week, final on day 9) and logged her first session. */
async function given(): Promise<ReviewWorld> {
  const world = await givenReviewWorld({ lengthWeeks: 4 });
  await logMinutes(world, "meditar", 0);
  await logMinutes(world, "meditar", 1);
  return world;
}

const andreaLeaves = (world: ReviewWorld) => (app: ReviewWorld["app"]) =>
  leaveCircle(app, world.andrea, { circleId: CIRCLE });

function expectConflict(outcome: PromiseSettledResult<unknown>) {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(ConcurrencyConflict);
}

describe("social writes lose to a concurrent leave or season close (read-set guard)", () => {
  it("a reaction racing the owner's leave conflicts and stores nothing", async () => {
    const world = await given();
    const { winner, loser } = await raceTransactions(
      world.at(DAY),
      andreaLeaves(world),
      (app) =>
        reactToFeedItem(app, world.victor, { seasonId: SEASON, itemKey: SESSION, emoji: "fire" }),
      "circles",
    );
    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await world.app.feedReactions.listBySeason(SEASON)).toEqual([]);
  });

  it("a reaction removal racing the owner's leave takes nothing away from a stale view", async () => {
    const world = await given();
    await reactToFeedItem(world.at(DAY), world.victor, {
      seasonId: SEASON,
      itemKey: SESSION,
      emoji: "fire",
    });
    const { winner, loser } = await raceTransactions(
      world.at(DAY),
      andreaLeaves(world),
      (app) => removeFeedReaction(app, world.victor, { seasonId: SEASON, itemKey: SESSION }),
      "circles",
    );
    expect(winner.status).toBe("fulfilled");
    // The conflict is retried once against the new state, where the owner is gone: not reactable.
    expect(loser).toEqual({
      status: "fulfilled",
      value: { ok: false, error: { kind: "FeedItemNotReactable" } },
    });
    expect(await world.app.feedReactions.listBySeason(SEASON)).toHaveLength(1);
  });

  it("a send racing the recipient's leave conflicts and stores nothing", async () => {
    const world = await given();
    const { winner, loser } = await raceTransactions(
      world.at(DAY),
      andreaLeaves(world),
      (app) =>
        sendEncouragement(app, world.victor, {
          seasonId: SEASON,
          recipientId: ANDREA,
          week: 1,
          emoji: "heart",
        }),
      "circles",
    );
    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toEqual([]);
  });

  it("a dismissal racing the target's leave conflicts and stores nothing", async () => {
    const world = await given();
    const { winner, loser } = await raceTransactions(
      world.at(DAY),
      andreaLeaves(world),
      (app) => dismissNudge(app, world.victor, { seasonId: SEASON, targetId: ANDREA, week: 1 }),
      "circles",
    );
    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await world.app.nudgeDismissals.listMine(SEASON, VICTOR)).toEqual([]);
  });

  // The in-memory stores let the loser's LATER reads see the winner's commit, so the loser may also
  // notice the closed season itself and refuse with NudgeNotAvailable (nothing stored either way).
  // The lock that serializes a send and a dismissal of the same case only exists over Postgres:
  // `social-concurrency.pg.test.ts` races it there. Either outcome below is a safe one; storing
  // the send is not.
  it("a send racing the final closer of the season stores nothing", async () => {
    const world = await given();
    await answerClosingReview(world, "andrea");
    await answerClosingReview(world, "victor");
    // Victor has closed; Andrea is the last closer and finalizes the season (its version changes).
    expect((await submitClosureAs(world, "victor", 30)).ok).toBe(true);
    const feed = await circleFeed(world.at(30), world.victor, {});
    const nudge = feed.ok ? feed.value.nudge : null;
    if (!nudge) throw new Error("the fixture must offer Victor a case on the results day");

    const { winner, loser } = await raceTransactions(
      world.at(30),
      (app) =>
        submitSeasonClosure(app, world.andrea, {
          seasonId: SEASON,
          decisions: decideAll(world, "andrea", "continue"),
        }),
      (app) =>
        sendEncouragement(app, world.victor, {
          seasonId: SEASON,
          recipientId: nudge.targetId,
          week: nudge.week,
          emoji: "heart",
        }),
    );
    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    if (loser.status === "rejected") expectConflict(loser);
    else expect(loser.value).toEqual({ ok: false, error: { kind: "NudgeNotAvailable" } });
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toEqual([]);
  });
});
