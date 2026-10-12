import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { ReviewCadenceWeeks, SeasonLengthWeeks } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { circleFixture, habitFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import {
  atInstant,
  fixtureTimeZone,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { PER_DAY_REACH, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDateOfEpochDay } from "../time/local-date.ts";

/** The civil date of 1-BASED season day `n`, also before the start (day 1 is {@link SEASON_START}, the spec's convention). */
export function dateOfDay(n: number): LocalDate {
  return localDateOfEpochDay(epochDay(SEASON_START) + n - 1);
}

export interface ReviewWorldOptions {
  readonly lengthWeeks?: SeasonLengthWeeks;
  readonly cadence?: ReviewCadenceWeeks;
  /** Drops Victor so Andrea is alone in the circle. */
  readonly solo?: boolean;
  /** Andrea's "Leer" commitment is private. */
  readonly privateLeer?: boolean;
  /** Andrea has no commitment at all (Victor is the only one with any). */
  readonly andreaWithoutCommitments?: boolean;
}

export interface ReviewWorld {
  readonly app: TestApp;
  readonly andrea: Actor;
  readonly victor: Actor;
  readonly meditar: ReturnType<typeof commitmentId>;
  readonly leer: ReturnType<typeof commitmentId>;
  readonly victorRun: ReturnType<typeof commitmentId>;
  /** A copy of the app whose clock reads noon (UTC-3) on 1-based season day `n`. */
  at(n: number): TestApp;
}

/**
 * GIVEN: an ACTIVE season (pact closed) whose day 1 is {@link SEASON_START}. Andrea holds "Meditar"
 * (every day, 60 %) and "Leer" (weekly total, 40 %); Victor holds one `done` commitment. Written
 * straight to the stores, bypassing the use cases. The clock reads day 1 until `at` moves it.
 */
export async function givenReviewWorld(options: ReviewWorldOptions = {}): Promise<ReviewWorld> {
  const app = createTestApp({ now: localInstant(dateOfDay(1)), timeZone: fixtureTimeZone });
  const andrea: Actor = { userId: userId("user-andrea") };
  const victor: Actor = { userId: userId("user-victor") };
  const andreaMember = memberFixture({
    id: memberId("member-andrea"),
    userId: andrea.userId,
    displayName: "Andrea",
  });
  const victorMember = memberFixture({
    id: memberId("member-victor"),
    userId: victor.userId,
    displayName: "Victor",
  });
  const circle = circleFixture({
    id: circleId("circle-1"),
    members: options.solo ? [andreaMember] : [andreaMember, victorMember],
  });
  const meditar = commitmentId("commitment-meditar");
  const leer = commitmentId("commitment-leer");
  const victorRun = commitmentId("commitment-victor");
  const andreaCommitments = options.andreaWithoutCommitments
    ? []
    : [
        buildCommitment({
          id: meditar,
          memberId: andreaMember.id,
          habitId: habitId("habit-meditar"),
          weightPercent: 60,
          privacy: "visible",
          measure: PER_DAY_REACH,
        }),
        buildCommitment({
          id: leer,
          memberId: andreaMember.id,
          habitId: habitId("habit-leer"),
          weightPercent: 40,
          privacy: options.privateLeer ? "private" : "visible",
          measure: WEEKLY_TOTAL,
        }),
      ];
  const season = seasonFixture({
    id: seasonId("season-1"),
    circleId: circle.id,
    status: "active",
    nominalStart: SEASON_START,
    actualStart: SEASON_START,
    lengthWeeks: options.lengthWeeks ?? 8,
    reviewCadenceWeeks: options.cadence ?? 2,
    pactClosedAt: instant(1),
    commitments: [
      ...andreaCommitments,
      buildCommitment({
        id: victorRun,
        memberId: victorMember.id,
        habitId: habitId("habit-victor"),
        weightPercent: 100,
        privacy: "visible",
        measure: {
          unit: "done",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
        },
      }),
    ],
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    await repos.seasons.save(season, null);
    for (const [id, owner, name] of [
      ["habit-meditar", andrea, "Meditar"],
      ["habit-leer", andrea, "Leer"],
      ["habit-victor", victor, "Correr"],
    ] as const) {
      await repos.habits.save(
        habitFixture({ id: habitId(id), ownerId: owner.userId, name, icon: "book" }),
        null,
      );
    }
    return { ok: true, value: undefined };
  });
  return {
    app,
    andrea,
    victor,
    meditar,
    leer,
    victorRun,
    at: (n) => atInstant(app, localInstant(dateOfDay(n))),
  };
}

/**
 * Logs `value` minutes for Andrea's "meditar" or "leer" on 0-based season day `day0`, at that
 * day's own noon (so it is always inside the entry window). Throws if the use case refuses.
 */
export async function logMinutes(
  world: ReviewWorld,
  which: "meditar" | "leer",
  day0: number,
  value = "30",
): Promise<void> {
  const result = await recordEntry(world.at(day0 + 1), world.andrea, {
    seasonId: seasonId("season-1"),
    commitmentId: world[which],
    forDate: dateOfDay(day0 + 1),
    value: { kind: "quantity", value },
    clientRequestId: `${which}-${day0}`,
  });
  if (!result.ok) throw new Error(`could not log ${which} on day ${day0}: ${result.error.kind}`);
}
