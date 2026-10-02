import type { Circle } from "../circle/circle.ts";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId, type Measure } from "../commitment/commitment.ts";
import type { Season, SeasonStatus } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import { epochDay, type LocalDate } from "../time/local-date.ts";
import type { TestApp } from "./app-harness.ts";
import { circleFixture, habitFixture, memberFixture, seasonFixture } from "./builders.ts";
import { createFixedClock } from "./fixed-clock.ts";
import { createFixedOffsetTimeZone } from "./fixed-time-zone.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** Fixtures run on a fixed UTC-3 zone (no DST) so local instants are plain arithmetic. */
const OFFSET_MINUTES = -180;

/** Day 0 of every fixture season (its actual start). */
export const SEASON_START = "2026-10-01" as LocalDate;

/** The instant at `msIntoDay` local time (UTC-3) on `date`, e.g. `0` is 00:00:00.000. */
export function localInstant(date: LocalDate, msIntoDay = 12 * 60 * 60_000): Instant {
  return instant(epochDay(date) * MS_PER_DAY + msIntoDay - OFFSET_MINUTES * MS_PER_MINUTE);
}

/** The last millisecond of a local day. */
export const END_OF_DAY = MS_PER_DAY - 1;

/** A copy of `app` whose clock reads `now` (same stores, same unit of work). */
export function atInstant(app: TestApp, now: Instant): TestApp {
  return { ...app, clock: createFixedClock(now) };
}

export interface ActiveSeasonFixture {
  readonly circle: Circle;
  readonly season: Season;
  /** Owns `andreaCommitment`. */
  readonly andrea: Actor;
  /** Owns `victorCommitment`. */
  readonly victor: Actor;
  readonly andreaCommitment: ReturnType<typeof commitmentId>;
  readonly victorCommitment: ReturnType<typeof commitmentId>;
}

const VICTOR_DONE: Measure = {
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};

/** Pass to `createTestApp({ timeZone })` so `localInstant` and the app agree on local dates. */
export const fixtureTimeZone = createFixedOffsetTimeZone({ offsetMinutes: OFFSET_MINUTES });

/**
 * GIVEN: a two-member circle whose season is stored directly (no use-case
 * setup) with its pact closed and `actualStart` = {@link SEASON_START}.
 * Andrea's commitment has the given `measure`; Victor's is a plain `done`.
 * Their habits ("Meditar", "Leer") are stored too.
 */
export async function givenActiveSeason(
  app: TestApp,
  measure: Measure,
  status: SeasonStatus = "active",
): Promise<ActiveSeasonFixture> {
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
  const circle = circleFixture({ id: circleId("circle-1"), members: [andreaMember, victorMember] });
  const andreaCommitment = commitmentId("commitment-andrea");
  const victorCommitment = commitmentId("commitment-victor");
  const season = seasonFixture({
    id: seasonId("season-1"),
    circleId: circle.id,
    status,
    nominalStart: SEASON_START,
    actualStart: status === "pactOpen" ? null : SEASON_START,
    lengthWeeks: 4,
    commitments: [
      buildCommitment({
        id: andreaCommitment,
        memberId: andreaMember.id,
        habitId: habitId("habit-andrea"),
        weightPercent: 100,
        privacy: "visible",
        measure,
      }),
      buildCommitment({
        id: victorCommitment,
        memberId: victorMember.id,
        habitId: habitId("habit-victor"),
        weightPercent: 100,
        privacy: "visible",
        measure: VICTOR_DONE,
      }),
    ],
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    await repos.seasons.save(season, null);
    await repos.habits.save(
      habitFixture({ id: habitId("habit-andrea"), ownerId: andrea.userId, name: "Meditar" }),
      null,
    );
    await repos.habits.save(
      habitFixture({ id: habitId("habit-victor"), ownerId: victor.userId, name: "Leer" }),
      null,
    );
    return { ok: true, value: undefined };
  });
  return { circle, season, andrea, victor, andreaCommitment, victorCommitment };
}
