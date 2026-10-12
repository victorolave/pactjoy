import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId, userId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { TestApp } from "./app-harness.ts";
import { memberFixture } from "./builders.ts";
import { type ActiveSeasonFixture, givenActiveSeason } from "./entry-fixtures.ts";
import { PER_DAY_REACH, WEEKLY_TOTAL } from "./entry-measures.ts";

/** The pause scenarios' world: Andrea (requester), Victor, optionally Sofia, and Andrea's second Commitment. */
export interface PauseWorld extends ActiveSeasonFixture {
  /** Andrea's second Commitment (weekly total), present when `withReading` is set. */
  readonly andreaReading: ReturnType<typeof commitmentId>;
  readonly sofia: Actor;
}

export interface PauseWorldOptions {
  /** Adds Sofia as a third active member (so a request has two approvers). */
  readonly withSofia?: boolean;
  /** Gives Andrea a second Commitment (for "Todos"). */
  readonly withReading?: boolean;
  /** Drops Victor so Andrea is alone in the circle (solo, Q1). */
  readonly solo?: boolean;
}

/**
 * GIVEN on top of `givenActiveSeason`: day 0 is 2026-10-01, a 4-week season
 * (cap 14 natural days per Commitment), fixed zone UTC-3. Written directly
 * to the stores, bypassing the use cases.
 */
export async function givenPauseWorld(
  app: TestApp,
  options: PauseWorldOptions = {},
): Promise<PauseWorld> {
  const base = await givenActiveSeason(app, PER_DAY_REACH);
  const sofia: Actor = { userId: userId("user-sofia") };
  const andreaReading = commitmentId("commitment-andrea-reading");
  const andreaMember = base.circle.members[0];
  if (!andreaMember) throw new Error("fixture has no Andrea");
  const members = options.solo
    ? [andreaMember]
    : [
        ...base.circle.members,
        ...(options.withSofia
          ? [
              memberFixture({
                id: memberId("member-sofia"),
                userId: sofia.userId,
                displayName: "Sofia",
              }),
            ]
          : []),
      ];
  const commitments: Season["commitments"] = [
    ...base.season.commitments.map((c) =>
      options.withReading && c.id === base.andreaCommitment ? { ...c, weightPercent: 50 } : c,
    ),
    ...(options.withReading
      ? [
          buildCommitment({
            id: andreaReading,
            memberId: andreaMember.id,
            habitId: habitId("habit-andrea"),
            weightPercent: 50,
            privacy: "visible",
            measure: WEEKLY_TOTAL,
          }),
        ]
      : []),
  ];
  const circle = { ...base.circle, members, version: base.circle.version + 1 };
  const season = { ...base.season, commitments, version: base.season.version + 1 };
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, base.circle.version);
    await repos.seasons.save(season, base.season.version);
    return { ok: true, value: undefined };
  });
  return { ...base, circle, season, andreaReading, sofia };
}

const HOUR_MS = 3_600_000;

/** The instant `hours` after `base` (real time, for the 48 h window). */
export function afterHours(base: Instant, hours: number): Instant {
  return instant(base + hours * HOUR_MS);
}
