import {
  type CommitmentRecord,
  circleId,
  habitId,
  localDate,
  type Measure,
  type MemberScoreView,
  memberId,
  memberScore,
  recordEntry,
  seasonId,
  standings,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { circleFixture, createTestApp, memberFixture, seasonFixture } from "@pactjoy/app/testing";
import { type CommitmentId, parseDecimal } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { presentMemberScore, presentStandings } from "../src/presenters/score.ts";
import { presentMeasure } from "../src/presenters/season.ts";

const ME = userId("u-me");
const M1 = memberId("m1");
const M2 = memberId("m2");
const WEEKLY = { period: "weeklyTotal" } as const;
const DAILY = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
} as const;
const UNITS = ["minutes", "hours", "times", "pages", "km", "glasses", "custom"] as const;
const PRECISIONS = ["integer", "decimal"] as const;
const DIRECTIONS = ["reach", "limit"] as const;

function measureOf(
  unit: (typeof UNITS)[number],
  direction: (typeof DIRECTIONS)[number],
  precision: (typeof PRECISIONS)[number],
  schedule: typeof WEEKLY | typeof DAILY,
): Measure {
  return {
    unit,
    customLabel: unit === "custom" ? "cups" : null,
    precision,
    target:
      direction === "reach"
        ? { direction, minimum: parseDecimal("1.5"), ideal: parseDecimal("12") }
        : { direction, ideal: parseDecimal("2"), tolerance: parseDecimal("7.25") },
    schedule,
  };
}

const matrix: Measure[] = [
  {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
  ...UNITS.flatMap((unit) =>
    DIRECTIONS.flatMap((direction) =>
      PRECISIONS.map((precision) => measureOf(unit, direction, precision, WEEKLY)),
    ),
  ),
];

function record(index: number, measure: Measure, owner = M1): CommitmentRecord {
  return {
    id: `k${index}` as CommitmentId,
    memberId: owner,
    habitId: habitId(`h${index}`),
    weightPercent: 1,
    privacy: "visible",
    measure,
  };
}

/** A started 4-week season (Bogota) with two members holding the given commitments. */
async function givenSeason(commitments: readonly CommitmentRecord[]) {
  const app = createTestApp();
  const circle = circleFixture({
    id: circleId("c1"),
    members: [
      memberFixture({ id: M1, userId: ME }),
      memberFixture({ id: M2, userId: userId("u-2") }),
    ],
  });
  const season = seasonFixture({
    id: seasonId("s1"),
    circleId: circle.id,
    timeZone: timeZoneId("America/Bogota"),
    nominalStart: localDate("2023-11-06"),
    actualStart: localDate("2023-11-06"),
    lengthWeeks: 4,
    status: "active",
    commitments,
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    await repos.seasons.save(season, null);
    return { ok: true, value: undefined };
  });
  return { app, season, actor: { userId: ME } };
}

describe("presentMeasure vs the app's own projection", () => {
  it("equals the measure memberScore (projectCommitment) emits, for every unit, direction and precision", async () => {
    const records = matrix.map((measure, index) => record(index, measure));
    const { app, season, actor } = await givenSeason(records);

    const result = await memberScore(app, actor, { seasonId: season.id });

    if (!result.ok || result.value.kind !== "scored") {
      throw new Error("expected a scored view");
    }
    expect(result.value.commitments).toHaveLength(matrix.length);
    result.value.commitments.forEach((view, index) => {
      const measure = matrix[index];
      if (view.kind !== "detail" || measure === undefined) {
        throw new Error(`expected a detail view at ${index}`);
      }
      expect(presentMeasure(measure)).toEqual(view.measure);
    });
  });
});

describe("realistic score views are JSON-safe", () => {
  it("S9: memberScore (own and others) and standings serialize without throwing", async () => {
    const mine = record(1, measureOf("pages", "reach", "integer", DAILY));
    const theirs = record(2, measureOf("km", "limit", "decimal", WEEKLY), M2);
    const { app, season, actor } = await givenSeason([mine, theirs]);
    const logged = await recordEntry(app, actor, {
      seasonId: season.id,
      commitmentId: mine.id,
      value: { kind: "quantity", value: "7" },
      clientRequestId: "r1",
    });
    expect(logged.ok).toBe(true);

    const own = await memberScore(app, actor, { seasonId: season.id });
    const others = await memberScore(app, actor, { seasonId: season.id, memberId: M2 });
    const ranking = await standings(app, actor, { seasonId: season.id });
    if (!(own.ok && others.ok && ranking.ok)) {
      throw new Error("expected every query to succeed");
    }
    const views: MemberScoreView[] = [own.value, others.value];
    for (const view of views) {
      expect(() => JSON.stringify(presentMemberScore(view))).not.toThrow();
    }
    expect(own.value).toMatchObject({ kind: "scored", scope: "own" });
    expect(others.value).toMatchObject({ kind: "scored", scope: "others" });
    expect(() => JSON.stringify(presentStandings(ranking.value))).not.toThrow();
    expect(ranking.value).toMatchObject({ kind: "ranked" });
  });
});
