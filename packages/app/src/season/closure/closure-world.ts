import { dateOfDay, type ReviewWorld } from "../../review/review-fixtures.ts";
import { submitReview } from "../../review/submit-review.ts";
import { circleId, type SeasonId, seasonId } from "../../shared/ids.ts";
import { createSeason } from "../create-season.ts";
import { type SubmitSeasonClosureInput, submitSeasonClosure } from "./submit-season-closure.ts";

/** Test setup shared by the closure suites: a 4-week review world (cadence 2, closing review = period 2). */
export const SEASON = seasonId("season-1");

type Who = "andrea" | "victor";

/** Completes `who`'s closing review on 1-based season day `day` (day 29 is the grace day). */
export async function answerClosingReview(world: ReviewWorld, who: Who, day = 29): Promise<void> {
  const actor = who === "andrea" ? world.andrea : world.victor;
  const commitments = who === "andrea" ? [world.meditar, world.leer] : [world.victorRun];
  const result = await submitReview(world.at(day), actor, {
    seasonId: SEASON,
    periodIndex: 2,
    reflection: { helped: null, hard: null },
    automaticity: commitments.map((commitmentId) => ({ commitmentId, items: [4, 4, 4, 4] })),
  });
  if (!result.ok) throw new Error(`closing review of ${who}: ${result.error.kind}`);
}

/** A decision for each of `who`'s commitments, all the same. */
export function decideAll(
  world: ReviewWorld,
  who: Who,
  decision: string,
): SubmitSeasonClosureInput["decisions"] {
  const commitments = who === "andrea" ? [world.meditar, world.leer] : [world.victorRun];
  return commitments.map((commitmentId) => ({ commitmentId, decision }));
}

/** `who` submits their closure on 1-based season day `day`. */
export function submitClosureAs(
  world: ReviewWorld,
  who: Who,
  day: number,
  decisions: SubmitSeasonClosureInput["decisions"] = decideAll(world, who, "continue"),
) {
  return submitSeasonClosure(world.at(day), who === "andrea" ? world.andrea : world.victor, {
    seasonId: SEASON,
    decisions,
  });
}

/**
 * Closes the world's season for good on season day 30: both members answer their closing review and
 * submit a closure (Andrea's decisions are given, Victor's are all `continue`). Returns nothing;
 * the season ends `closed`.
 */
export async function givenSeasonClosed(
  world: ReviewWorld,
  andreaDecisions: SubmitSeasonClosureInput["decisions"] = decideAll(world, "andrea", "continue"),
): Promise<void> {
  await answerClosingReview(world, "andrea");
  await answerClosingReview(world, "victor");
  const first = await submitClosureAs(world, "andrea", 30, andreaDecisions);
  const last = await submitClosureAs(world, "victor", 30);
  if (!first.ok || !last.ok) throw new Error("could not close the season");
}

/** Andrea opens the circle's next season (pact open) on season day `day` of the previous one. */
export async function givenNextSeason(world: ReviewWorld, day = 31): Promise<SeasonId> {
  const created = await createSeason(world.at(day), world.andrea, {
    circleId: circleId("circle-1"),
    timezone: "America/Santiago",
    startDate: dateOfDay(day),
    lengthWeeks: 4,
  });
  if (!created.ok) throw new Error(`could not open the next season: ${created.error.kind}`);
  return created.value.season.id;
}
