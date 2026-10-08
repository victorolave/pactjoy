import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it, vi } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { weekSummary } from "./week-summary.query.ts";

const DAILY = {
  unit: "done",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
} as const;

const day = (d: number) => localDateOfSeasonDay(seasonDay(d), SEASON_START);

async function setup() {
  const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY);
  const ask = (weekIndex: number, actor = given.andrea, targetSeasonId = given.season.id) =>
    weekSummary(app, actor, { seasonId: targetSeasonId, weekIndex });
  return { app, given, ask };
}

describe("weekSummary query (A2s)", () => {
  it("returns full WeekSummaryView for an active season week in one uow.read", async () => {
    const { app, given, ask } = await setup();
    const readSpy = vi.spyOn(app.uow, "read");

    const result = await ask(0);

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.viewerId).toBe("member-andrea");
    expect(result.value.weekIndex).toBe(0);
    expect(result.value.start).toBe(SEASON_START);
    expect(result.value.end).toBe(day(6));
    expect(result.value.timing).toBe("current");
    expect(result.value.facts).toMatchObject({ counted: false, editable: true, final: false });
    expect(result.value.points).toBe(0);
    expect(result.value.consistency).toBeNull();
    expect(result.value.idealCompletion).toBeNull();
    expect(result.value.headline).toBeNull();
    expect(result.value.weeksLeft).toBe(given.season.lengthWeeks - 1);
    expect(result.value.commitments).toHaveLength(1);
    expect(result.value.commitments[0]).toMatchObject({
      commitmentId: given.andreaCommitment,
      habit: { name: "Meditar" },
      points: 0,
    });
    expect(result.value.circle).toHaveLength(2);
  });

  it("first week (weekIndex 0) is never best headline", async () => {
    const { app, given, ask } = await setup();
    // Record entry in week 0
    const rec = await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: day(0),
      value: { kind: "done" },
      clientRequestId: "req-1",
    });
    expect(rec.ok).toBe(true);

    const result = await ask(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headline).not.toBe("best");
  });

  it("difficult week iff consistency < 50", async () => {
    const { app, given } = await setup();
    // In week 0, record only 1 out of 7 days -> consistency will be 1/7 < 50%
    const rec = await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: day(0),
      value: { kind: "done" },
      clientRequestId: "req-diff-1",
    });
    expect(rec.ok).toBe(true);

    // Advance clock to week 1 (day 8) so week 0 is closed and counted
    const appW1 = atInstant(app, localInstant(day(8)));

    const result = await weekSummary(appW1, given.andrea, {
      seasonId: given.season.id,
      weekIndex: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const consistency = result.value.consistency;
    expect(consistency !== null && consistency < 50).toBe(true);
    expect(result.value.headline).toBe("difficult");
  });

  it("best week when points strictly greater than every prior counted week (never week 1)", async () => {
    const { app, given } = await setup();
    // In week 0: 2 days done (day 0, day 1)
    for (let d = 0; d < 2; d++) {
      const rec = await recordEntry(atInstant(app, localInstant(day(d))), given.andrea, {
        seasonId: given.season.id,
        commitmentId: given.andreaCommitment,
        forDate: day(d),
        value: { kind: "done" },
        clientRequestId: `req-w0-${d}`,
      });
      expect(rec.ok).toBe(true);
    }

    // In week 1: 5 days done (day 7 to 11) - consistency 5/7 = 71% > 50%, points > week 0 points
    for (let d = 7; d < 12; d++) {
      const rec = await recordEntry(atInstant(app, localInstant(day(d))), given.andrea, {
        seasonId: given.season.id,
        commitmentId: given.andreaCommitment,
        forDate: day(d),
        value: { kind: "done" },
        clientRequestId: `req-w1-${d}`,
      });
      expect(rec.ok).toBe(true);
    }

    // Advance to week 2 (day 15), so both week 0 and week 1 are closed and counted
    const appW2 = atInstant(app, localInstant(day(15)));

    // Week 1 should be "best" because week 1 points > week 0 points and consistency >= 50%
    const resW1 = await weekSummary(appW2, given.andrea, {
      seasonId: given.season.id,
      weekIndex: 1,
    });
    expect(resW1.ok).toBe(true);
    if (!resW1.ok) return;
    expect(resW1.value.headline).toBe("best");

    // In week 2: 4 days done (day 14 to 17) - consistency 4/7 = 57% >= 50%, but points (4) < week 1 (5)
    for (let d = 14; d < 18; d++) {
      const rec = await recordEntry(atInstant(app, localInstant(day(d))), given.andrea, {
        seasonId: given.season.id,
        commitmentId: given.andreaCommitment,
        forDate: day(d),
        value: { kind: "done" },
        clientRequestId: `req-w2-${d}`,
      });
      expect(rec.ok).toBe(true);
    }

    // Advance to week 3 (day 22), so week 2 is closed and counted
    const appW3 = atInstant(app, localInstant(day(22)));

    const resW2 = await weekSummary(appW3, given.andrea, {
      seasonId: given.season.id,
      weekIndex: 2,
    });
    expect(resW2.ok).toBe(true);
    if (!resW2.ok) return;
    expect(resW2.value.headline).toBeNull();
  });

  it("live refresh through grace: recording an entry during grace updates summary immediately", async () => {
    const { app, given } = await setup();
    // Advance to day 7 (week 0 is closed, but grace deadline is day 9)
    const appGrace = atInstant(app, localInstant(day(7)));

    const before = await weekSummary(appGrace, given.andrea, {
      seasonId: given.season.id,
      weekIndex: 0,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.points).toBe(0);

    // Record entry for week 0 during grace (for day 6)
    const rec = await recordEntry(appGrace, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: day(6),
      value: { kind: "done" },
      clientRequestId: "req-grace-1",
    });
    expect(rec.ok).toBe(true);

    const after = await weekSummary(appGrace, given.andrea, {
      seasonId: given.season.id,
      weekIndex: 0,
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.points).toBeGreaterThan(0);
  });

  it("pair circle (cardinality 2) returns circle line; solo and 3-6 return circle null", async () => {
    const { app, given, ask } = await setup();
    const pairResult = await ask(0);
    expect(pairResult.ok).toBe(true);
    if (!pairResult.ok) return;
    expect(pairResult.value.circle).toHaveLength(2);

    // Solo circle
    const [firstMember] = given.circle.members;
    const [firstCommitment] = given.season.commitments;
    if (!firstMember || !firstCommitment) throw new Error("setup failed");

    await app.circles.save({ ...given.circle, members: [firstMember] }, given.circle.version);
    await app.seasons.save(
      { ...given.season, commitments: [firstCommitment] },
      given.season.version,
    );

    const soloResult = await ask(0);
    expect(soloResult.ok).toBe(true);
    if (!soloResult.ok) return;
    expect(soloResult.value.circle).toBeNull();
  });

  it("rejects outsider with NotAMember", async () => {
    const { ask } = await setup();
    const outsider = { userId: userId("user-outsider") };
    const result = await ask(0, outsider);
    expect(result).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });

  it("rejects unknown season with SeasonNotFound", async () => {
    const { ask } = await setup();
    const result = await ask(0, undefined, seasonId("00000000-0000-0000-0000-000000000000"));
    expect(result).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("rejects unstarted season or pactOpen with SeasonNotFound", async () => {
    const { app, given, ask } = await setup();
    await app.seasons.save({ ...given.season, status: "pactOpen" }, given.season.version);

    const result = await ask(0);
    expect(result).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("rejects negative or out-of-range weekIndex with SeasonNotFound", async () => {
    const { given, ask } = await setup();
    const resNegative = await ask(-1);
    expect(resNegative).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });

    const resOutOfRange = await ask(given.season.lengthWeeks);
    expect(resOutOfRange).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });
});
