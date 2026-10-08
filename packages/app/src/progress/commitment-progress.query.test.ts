import { fromInt } from "@pactjoy/engine";
import { describe, expect, it, vi } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { epochDay, localDateOfEpochDay } from "../time/local-date.ts";
import { commitmentProgress } from "./commitment-progress.query.ts";

const DAY = (n: number) => localDateOfEpochDay(epochDay(SEASON_START) + n);
const READING: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

/** Andrea reads daily (4 weeks, 28 opportunities); day 0 at 30 min with a note, day 1 logged late. */
async function setup(privacy: "visible" | "private" = "visible") {
  const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, READING);
  await app.seasons.save(
    {
      ...given.season,
      commitments: given.season.commitments.map((c) =>
        c.id === given.andreaCommitment ? { ...c, privacy } : c,
      ),
    },
    0,
  );
  const log = async (day: number, value: string, recordedOn: number, note?: string) => {
    const result = await recordEntry(atInstant(app, localInstant(DAY(recordedOn))), given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      value: { kind: "quantity", value },
      clientRequestId: `r-${day}`,
      forDate: DAY(day),
      ...(note === undefined ? {} : { note }),
    });
    expect(result.ok).toBe(true);
  };
  await log(0, "30", 0, "Capítulo 3");
  await log(1, "10", 2);
  const today = atInstant(app, localInstant(DAY(2)));
  const ask = (actor = given.andrea, commitment = given.andreaCommitment) =>
    commitmentProgress(today, actor, { seasonId: given.season.id, commitmentId: commitment });
  return { app: today, given, ask };
}

describe("commitmentProgress (24a, 24b)", () => {
  it("the owner's commitment: detail row, engine history cells and authorized evidence", async () => {
    const { ask } = await setup();

    const result = await ask();
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected a view");
    const view = result.value;
    expect(view).toMatchObject({
      state: "active",
      memberId: "member-andrea",
      commitment: {
        kind: "detail",
        commitmentId: "commitment-andrea",
        habit: { name: "Meditar" },
        opportunities: { kept: 2, counted: 2 },
      },
    });
    expect(view.weeks).toHaveLength(4);
    const [week] = view.weeks;
    expect(week).toMatchObject({ weekIndex: 0, start: DAY(0), end: DAY(6), timing: "current" });
    expect(week?.cells.map((cell) => [cell.date, cell.status, cell.late])).toEqual([
      [DAY(0), "ideal", false],
      [DAY(1), "minimum", true],
      [DAY(2), "pending", false],
      [DAY(3), "future", false],
      [DAY(4), "future", false],
      [DAY(5), "future", false],
      [DAY(6), "future", false],
    ]);
    expect(week?.cells[0]?.evidence).toEqual([
      {
        forDate: DAY(0),
        recordedOn: DAY(0),
        value: { kind: "quantity", value: "30" },
        note: "Capítulo 3",
      },
    ]);
    expect(week?.cells[1]?.evidence[0]).toMatchObject({ forDate: DAY(1), recordedOn: DAY(2) });
    // No entry ids, request ids or user ids leave the server.
    const json = JSON.stringify(view);
    for (const secret of ["clientRequestId", "r-0", "user-", "entryId", '"version"']) {
      expect(json).not.toContain(secret);
    }
  });

  it("Cómo puntúa: the engine's progress at sample values and one opportunity's worth", async () => {
    const { ask } = await setup();

    const result = await ask();
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected a view");
    // 1000 points over 28 daily opportunities.
    expect(result.value.scoring).toEqual({
      perOpportunityPoints: "35.71",
      opportunityCount: 28,
      curve: [
        { value: "5", progressPercent: "0" },
        { value: "10", progressPercent: "33" },
        { value: "20", progressPercent: "67" },
        { value: "30", progressPercent: "100" },
        { value: "60", progressPercent: "100" },
      ],
    });
  });

  it("a peer's visible commitment is readable, with its evidence", async () => {
    const { given, ask } = await setup();

    const result = await ask(given.victor);
    expect(result).toMatchObject({ ok: true, value: { memberId: "member-andrea" } });
  });

  it("a peer's private commitment fails closed before any habit read", async () => {
    const { app, given, ask } = await setup("private");
    const habits = vi.spyOn(app.habits, "getMany");

    expect(await ask(given.victor)).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
    expect(habits).not.toHaveBeenCalled();
  });

  it("an outsider and an unknown commitment are denied", async () => {
    const { ask, given } = await setup();

    expect(await ask({ userId: userId("outsider") })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(await ask(given.andrea, commitmentId("ghost"))).toEqual({
      ok: false,
      error: { kind: "CommitmentNotFound" },
    });
  });

  it("captures the clock and reads once", async () => {
    const { app, ask } = await setup();
    const clock = vi.spyOn(app.clock, "now");
    const read = vi.spyOn(app.uow, "read");

    await ask();
    expect(clock).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("done / not done has no curve (consistency and ideal coincide)", async () => {
    const { given, app } = await setup();
    const result = await commitmentProgress(app, given.victor, {
      seasonId: given.season.id,
      commitmentId: given.victorCommitment,
    });
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected a view");
    expect(result.value.scoring.curve).toBeNull();
    expect(result.value.commitment.measure.unit).toBe("done");
  });
});
