import { describe, expect, it } from "vitest";
import { deleteEntry } from "../entry/delete-entry.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { givenRecordedEntry } from "../testing/recorded-entry-fixture.ts";
import { memberScore } from "./member-score.query.ts";
import { standings } from "./standings.query.ts";

/** Andrea recorded a full session on day 0; the queries then run on day 10. */
async function scenario() {
  const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 0);
  const readAt = atInstant(app, localInstant(dayOf(10)));
  const read = async () => ({
    score: await memberScore(readAt, given.andrea, { seasonId: given.season.id }),
    ranking: await standings(readAt, given.andrea, { seasonId: given.season.id }),
  });
  const remove = () =>
    deleteEntry(atInstant(app, localInstant(dayOf(0))), given.andrea, { entryId: entry.id });
  return { read, remove };
}

/** The same season and clock with no entry ever recorded. */
async function neverRecorded() {
  const app = createTestApp({ now: localInstant(dayOf(10)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return {
    score: await memberScore(app, given.andrea, { seasonId: given.season.id }),
    ranking: await standings(app, given.andrea, { seasonId: given.season.id }),
  };
}

describe("scoring never sees deleted entries", () => {
  it("the entry counts while it exists", async () => {
    const { read } = await scenario();

    expect(await read()).toMatchObject({ score: { value: { points: 36 } } });
  });

  it("memberScore after a delete equals memberScore with no entry", async () => {
    const { read, remove } = await scenario();
    expect((await remove()).ok).toBe(true);

    expect((await read()).score).toEqual((await neverRecorded()).score);
  });

  it("standings after a delete equal standings with no entry", async () => {
    const { read, remove } = await scenario();
    expect((await remove()).ok).toBe(true);

    expect((await read()).ranking).toEqual((await neverRecorded()).ranking);
  });
});
