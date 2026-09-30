import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import type { Actor } from "../shared/actor.ts";
import { entryId, seasonId, userId } from "../shared/ids.ts";
import type { TestApp } from "../testing/app-harness.ts";
import { atInstant, END_OF_DAY, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH, TIMES_PER_WEEK, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { changeSeason, expectConflict } from "../testing/entry-test-helpers.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { givenRecordedEntry } from "../testing/recorded-entry-fixture.ts";
import type { Instant } from "../time/instant.ts";
import { deleteEntry } from "./delete-entry.ts";
import type { EntryRecord } from "./entry.ts";

function remove(app: TestApp, at: Instant, actor: Actor, entry: EntryRecord, id = entry.id) {
  return deleteEntry(atInstant(app, at), actor, { entryId: id });
}

async function stored(app: TestApp, entry: EntryRecord) {
  return app.uow.read((repos) => repos.entries.get(entry.id));
}

describe("deleteEntry: deleting", () => {
  it("removes the entry inside its window (ER-10)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const result = await remove(app, localInstant(dayOf(6), END_OF_DAY), given.andrea, entry);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await stored(app, entry)).toBeNull();
    expect(await app.uow.read((repos) => repos.entries.listBySeason(given.season.id))).toEqual([]);
  });

  it("leaves a tombstone that keeps the idempotency key and bumps the version", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    await remove(app, localInstant(dayOf(5)), given.andrea, entry);

    const found = await app.uow.read((repos) =>
      repos.entries.findByClientRequest(entry.memberId, entry.commitmentId, entry.clientRequestId),
    );
    expect(found).toEqual({ ...entry, deleted: true, version: entry.version + 1 });
  });

  it("cannot delete or find an already deleted entry", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await remove(app, localInstant(dayOf(5)), given.andrea, entry);

    expect(await remove(app, localInstant(dayOf(5)), given.andrea, entry)).toEqual({
      ok: false,
      error: { kind: "EntryNotFound" },
    });
  });

  it("closes the per-session window after the day's own grace (ER-11)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const late = await remove(app, localInstant(dayOf(7), 0), given.andrea, entry);

    expect(late).toEqual({ ok: false, error: { kind: "WindowClosed" } });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("keeps a week-bound entry deletable through the week's grace, then closes (ER-12, ER-13)", async () => {
    const { app, given, entry } = await givenRecordedEntry(WEEKLY_TOTAL, 1);
    const closed = await remove(app, localInstant(dayOf(8), 0), given.andrea, entry);

    expect(closed).toEqual({ ok: false, error: { kind: "WindowClosed" } });
    const open = await remove(app, localInstant(dayOf(7), END_OF_DAY), given.andrea, entry);
    expect(open.ok).toBe(true);
  });

  it("gives timesPerWeek sessions the week-bound window, not day + 1 (B8)", async () => {
    const { app, given, entry } = await givenRecordedEntry(TIMES_PER_WEEK, 1);

    // Day 5 is past the session's own day + 1 but inside its week.
    expect((await remove(app, localInstant(dayOf(5)), given.andrea, entry)).ok).toBe(true);
  });

  it("measures the window from the entry's day, not from when it was recorded", async () => {
    // Recorded on day 6 for day 5 (inside grace): its window still ends with day 6.
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 6, 5);

    expect(await remove(app, localInstant(dayOf(7), 0), given.andrea, entry)).toEqual({
      ok: false,
      error: { kind: "WindowClosed" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });
});

describe("deleteEntry: who and what", () => {
  it("only the owner may delete (ER-18): another member, a stranger and an unknown entry", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const now = localInstant(dayOf(5));
    const stranger: Actor = { userId: userId("user-stranger") };

    expect(await remove(app, now, given.victor, entry)).toEqual({
      ok: false,
      error: { kind: "EntryNotOwned" },
    });
    expect(await remove(app, now, stranger, entry)).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(await remove(app, now, given.andrea, entry, "nope" as typeof entry.id)).toEqual({
      ok: false,
      error: { kind: "EntryNotFound" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("rejects an entry whose season no longer exists", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const orphan = { ...entry, id: entryId("orphan"), seasonId: seasonId("gone") };
    await app.entries.add({ ...orphan, clientRequestId: "orphan" });

    expect(await remove(app, localInstant(dayOf(5)), given.andrea, orphan)).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("freezes the past entries of a member who left (B9)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await leaveCircle(app, given.andrea, { circleId: given.circle.id });

    expect(await remove(app, localInstant(dayOf(5)), given.andrea, entry)).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("rejects an entry whose season is no longer active", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await changeSeason(app, given.season, { status: "closed" });

    expect(await remove(app, localInstant(dayOf(5)), given.andrea, entry)).toEqual({
      ok: false,
      error: { kind: "SeasonNotActive" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("rejects an entry whose commitment no longer exists in the season", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await changeSeason(app, given.season, {
      commitments: given.season.commitments.filter((c) => c.id !== given.andreaCommitment),
    });

    expect(await remove(app, localInstant(dayOf(5)), given.andrea, entry)).toEqual({
      ok: false,
      error: { kind: "EntryNotFound" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });
});

describe("deleteEntry: concurrency (D5)", () => {
  it("an edit committed first makes the in-flight delete conflict: the edited entry stays", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const edited = { ...entry, note: "edited", editedAt: localInstant(dayOf(5)), version: 1 };

    const { winner, loser } = await raceTransactions(
      app,
      (a) =>
        a.uow.transaction(async (repos) => {
          await repos.entries.replace(edited, entry.version);
          return { ok: true as const, value: undefined };
        }),
      (a) => remove(a, localInstant(dayOf(5)), given.andrea, entry),
      "circles",
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await stored(app, entry)).toEqual(edited);
  });

  it("a member leaving first makes the in-flight delete conflict and delete nothing", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, given.andrea, { circleId: given.circle.id }),
      (a) => remove(a, localInstant(dayOf(5)), given.andrea, entry),
      "circles",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expectConflict(loser);
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("a season change first makes the in-flight delete conflict and delete nothing", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => changeSeason(a, given.season),
      (a) => remove(a, localInstant(dayOf(5)), given.andrea, entry),
      "circles",
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await stored(app, entry)).toEqual(entry);
  });
});
