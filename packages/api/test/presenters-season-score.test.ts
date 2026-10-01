import {
  type CommitmentRecord,
  circleId,
  habitId,
  instant,
  localDate,
  type MeasureView,
  type MemberScoreView,
  memberId,
  type Season,
  type StandingsView,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { type CommitmentId, frac, fromInt, parseDecimal } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { presentMemberScore, presentStandings } from "../src/presenters/score.ts";
import { presentMeasure, presentSeason } from "../src/presenters/season.ts";

const T = instant(1_700_000_000_123);
const ISO = "2023-11-14T22:13:20.123Z";
const cid = (s: string) => s as CommitmentId;

const reach: CommitmentRecord = {
  id: cid("k1"),
  memberId: memberId("m1"),
  habitId: habitId("h1"),
  weightPercent: 50,
  privacy: "visible",
  measure: {
    unit: "pages",
    customLabel: null,
    precision: "integer",
    target: { direction: "reach", minimum: frac(1n, 2n), ideal: fromInt(3) },
    schedule: { period: "weeklyTotal" },
  },
};
const limit: CommitmentRecord = {
  id: cid("k2"),
  memberId: memberId("m1"),
  habitId: habitId("h2"),
  weightPercent: 30,
  privacy: "visible",
  measure: {
    unit: "times",
    customLabel: null,
    precision: "integer",
    target: { direction: "limit", ideal: fromInt(3), tolerance: parseDecimal("5.25") },
    schedule: { period: "weeklyTotal" },
  },
};
const priv: CommitmentRecord = {
  id: cid("k3"),
  memberId: memberId("m1"),
  habitId: habitId("secret-habit"),
  weightPercent: 20,
  privacy: "private",
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
};

const season: Season = {
  id: seasonId("s1"),
  circleId: circleId("c1"),
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-05"),
  actualStart: null,
  lengthWeeks: 4,
  reviewCadenceWeeks: 1,
  status: "pactOpen",
  commitments: [reach, limit, priv],
  approvals: [{ memberId: memberId("m1"), approvedAt: T }],
  pactClosedAt: null,
  createdAt: T,
  version: 2,
};

function noBigint(value: unknown): void {
  expect(typeof value).not.toBe("bigint");
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) {
      noBigint(v);
    }
  }
}

describe("presenters: season, score", () => {
  it("PR-S1/S2/S3: fractions are exact decimal strings and the body is JSON-safe", () => {
    const dto = presentSeason(season);
    noBigint(dto);
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
    const [a, b] = dto.commitments;
    expect(a).toMatchObject({
      kind: "detail",
      measure: { target: { minimum: "0.5", ideal: "3" } },
    });
    expect(b).toMatchObject({
      measure: { target: { direction: "limit", ideal: "3", tolerance: "5.25" } },
    });
  });

  it("measure mapping is typed against MeasureView", () => {
    const view: MeasureView = presentMeasure(reach.measure);
    expect(view).toEqual(presentMeasure(reach.measure));
    expect(presentMeasure(priv.measure)).toEqual(priv.measure);
  });

  it("private commitments are hidden for everyone: only id, member and weight", () => {
    const hidden = presentSeason(season).commitments[2];
    expect(hidden).toEqual({ kind: "hidden", id: "k3", memberId: "m1", weightPercent: 20 });
    expect(JSON.stringify(presentSeason(season))).not.toContain("secret-habit");
  });

  it("season fields: ISO instants, dates, approvals", () => {
    expect(presentSeason(season)).toMatchObject({
      id: "s1",
      circleId: "c1",
      timeZone: "America/Bogota",
      nominalStart: "2026-10-05",
      actualStart: null,
      lengthWeeks: 4,
      approvals: [{ memberId: "m1", approvedAt: ISO }],
      pactClosedAt: null,
      createdAt: ISO,
      version: 2,
    });
  });

  it("PR-S8/S9/S10/S11: score views pass through unchanged and serialize", () => {
    const own: MemberScoreView = {
      kind: "scored",
      scope: "own",
      memberId: memberId("m1"),
      points: 500,
      consistency: null,
      idealCompletion: null,
      commitments: [{ kind: "hidden", commitmentId: cid("k3"), weightPercent: 20, points: 10 }],
    };
    const others: MemberScoreView = { ...own, scope: "others" } as never;
    delete (others as unknown as Record<string, unknown>).consistency;
    delete (others as unknown as Record<string, unknown>).idealCompletion;
    expect(JSON.parse(JSON.stringify(presentMemberScore(own)))).toMatchObject({
      consistency: null,
    });
    const othersJson = JSON.parse(JSON.stringify(presentMemberScore(others)));
    expect(othersJson).not.toHaveProperty("consistency");
    expect(othersJson).not.toHaveProperty("idealCompletion");
    const ranked: StandingsView = {
      kind: "ranked",
      rows: [{ memberId: memberId("m1"), rank: 1, points: 10 }],
      eligibleParticipantCount: 1,
    };
    expect(JSON.parse(JSON.stringify(presentStandings(ranked)))).toEqual(ranked);
    expect(presentStandings({ kind: "notStarted" })).toEqual({ kind: "notStarted" });
  });
});
