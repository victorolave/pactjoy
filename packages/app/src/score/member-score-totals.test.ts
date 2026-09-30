import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { Actor } from "../shared/actor.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { type MemberScoreView, memberScore } from "./member-score.query.ts";

const ANDREA = memberId("member-andrea");
const DAILY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

/** Andrea has logged one full session; both members then read Andrea's score. */
async function setup() {
  const app = createTestApp({
    now: localInstant(localDate("2026-10-01")),
    timeZone: fixtureTimeZone,
  });
  const given = await givenActiveSeason(app, DAILY_REACH);
  await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    value: { kind: "quantity", value: "30" },
    clientRequestId: "r1",
  });
  const view = async (viewer: Actor): Promise<MemberScoreView> => {
    const result = await memberScore(app, viewer, { seasonId: given.season.id, memberId: ANDREA });
    if (!result.ok) throw new Error("expected a score");
    return result.value;
  };
  const viewAsJson = async (viewer: Actor) => JSON.parse(JSON.stringify(await view(viewer)));
  return { app, given, view, viewAsJson };
}

describe("memberScore: member-level totals", () => {
  it("the member themself sees points, consistency and idealCompletion", async () => {
    const { given, viewAsJson } = await setup();

    expect(await viewAsJson(given.andrea)).toMatchObject({
      kind: "scored",
      scope: "own",
      memberId: ANDREA,
      points: 36,
      consistency: 100,
      idealCompletion: 100,
    });
  });

  it("another member sees only points: consistency and idealCompletion are absent", async () => {
    const { given, view, viewAsJson } = await setup();
    const keys = ["commitments", "kind", "memberId", "points", "scope"];

    const raw = await view(given.victor);
    const json = await viewAsJson(given.victor);

    expect(raw).toMatchObject({ kind: "scored", scope: "others", memberId: ANDREA, points: 36 });
    expect(Object.keys(raw).sort()).toEqual(keys);
    expect(Object.keys(json).sort()).toEqual(keys);
  });

  it("the whole view another member gets is points plus a hidden private commitment, nothing else", async () => {
    const { app, given, view } = await setup();
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        {
          ...given.season,
          commitments: given.season.commitments.map((commitment) =>
            commitment.id === given.andreaCommitment
              ? { ...commitment, privacy: "private" as const }
              : commitment,
          ),
        },
        given.season.version,
      );
      return { ok: true, value: undefined };
    });

    expect(await view(given.victor)).toStrictEqual({
      kind: "scored",
      scope: "others",
      memberId: ANDREA,
      points: 36,
      commitments: [
        { kind: "hidden", commitmentId: given.andreaCommitment, weightPercent: 100, points: 36 },
      ],
    });
  });

  it("the own view is complete even when nothing has been counted yet", async () => {
    const app = createTestApp({
      now: localInstant(localDate("2026-10-01")),
      timeZone: fixtureTimeZone,
    });
    const given = await givenActiveSeason(app, DAILY_REACH);

    const result = await memberScore(app, given.andrea, { seasonId: given.season.id });

    expect(result).toMatchObject({
      ok: true,
      value: { scope: "own", points: 0, consistency: null, idealCompletion: null },
    });
  });
});
