import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import type { Actor } from "../shared/actor.ts";
import type { TestApp } from "../testing/app-harness.ts";
import { atInstant, END_OF_DAY, localInstant } from "../testing/entry-fixtures.ts";
import {
  dayOf,
  LIMIT,
  PER_DAY_REACH,
  TIMES_PER_WEEK,
  WEEKLY_TOTAL,
} from "../testing/entry-measures.ts";
import { changeSeason, expectConflict } from "../testing/entry-test-helpers.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { givenRecordedEntry } from "../testing/recorded-entry-fixture.ts";
import type { Instant } from "../time/instant.ts";
import { deleteEntry } from "./delete-entry.ts";
import { type EditEntryInput, editEntry } from "./edit-entry.ts";
import { type EntryRecord, MAX_NOTE_LENGTH } from "./entry.ts";

function edit(
  app: TestApp,
  at: Instant,
  actor: Actor,
  entry: EntryRecord,
  overrides: Partial<EditEntryInput> = {},
) {
  return editEntry(atInstant(app, at), actor, {
    entryId: entry.id,
    value: { kind: "quantity", value: "45" },
    note: "edited",
    ...overrides,
  });
}

async function stored(app: TestApp, entry: EntryRecord) {
  return app.uow.read((repos) => repos.entries.get(entry.id));
}

describe("editEntry: editing", () => {
  it("replaces value and note, stamps editedAt and keeps everything else (ER-10)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const at = localInstant(dayOf(6), END_OF_DAY);

    const result = await edit(app, at, given.andrea, entry);

    const expected = {
      ...entry,
      value: { kind: "quantity", value: fromInt(45) },
      note: "edited",
      editedAt: at,
      version: 1,
    };
    expect(result).toEqual({ ok: true, value: { entry: expected } });
    expect(await stored(app, entry)).toEqual(expected);
  });

  it("can clear the note with null and switch a day-bound reach entry to missed", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    await edit(app, localInstant(dayOf(5)), given.andrea, entry, {
      value: { kind: "missed" },
      note: null,
    });

    expect(await stored(app, entry)).toMatchObject({ value: { kind: "missed" }, note: null });
  });

  it("closes the per-session window after the day's own grace (ER-11)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const late = await edit(app, localInstant(dayOf(7), 0), given.andrea, entry);

    expect(late).toEqual({ ok: false, error: { kind: "WindowClosed" } });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("keeps a week-bound entry editable mid-week and through the week's grace, then closes (ER-12, ER-13)", async () => {
    const { app, given, entry } = await givenRecordedEntry(WEEKLY_TOTAL, 1);

    expect((await edit(app, localInstant(dayOf(5)), given.andrea, entry)).ok).toBe(true);
    const closed = await edit(app, localInstant(dayOf(8), 0), given.andrea, entry);
    expect(closed).toEqual({ ok: false, error: { kind: "WindowClosed" } });
    const last = await edit(app, localInstant(dayOf(7), END_OF_DAY), given.andrea, entry);
    expect(last.ok).toBe(true);
  });

  it("gives timesPerWeek sessions the week-bound window, not day + 1 (B8)", async () => {
    const { app, given, entry } = await givenRecordedEntry(TIMES_PER_WEEK, 1);

    // Day 5 is past the session's own day + 1 but inside its week.
    expect((await edit(app, localInstant(dayOf(5)), given.andrea, entry)).ok).toBe(true);
  });

  it("edits an already edited entry again, from its current state", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await edit(app, localInstant(dayOf(5)), given.andrea, entry, { note: "first" });
    const again = localInstant(dayOf(6));

    const result = await edit(app, again, given.andrea, entry, { note: "second" });

    expect(result).toMatchObject({
      ok: true,
      value: { entry: { note: "second", editedAt: again, version: 2 } },
    });
    expect(await stored(app, entry)).toMatchObject({ note: "second", version: 2 });
  });

  it("freezes the entry of a member who left (B9)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    await leaveCircle(app, given.andrea, { circleId: given.circle.id });

    const result = await edit(app, localInstant(dayOf(5)), given.andrea, entry);

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("only the owner may edit (ER-18)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const other = await edit(app, localInstant(dayOf(5)), given.victor, entry);

    expect(other).toEqual({ ok: false, error: { kind: "EntryNotOwned" } });
    expect(await stored(app, entry)).toEqual(entry);
  });
});

describe("editEntry: the new value", () => {
  it("validates against the commitment like recordEntry and leaves the entry untouched", async () => {
    const { app, given, entry } = await givenRecordedEntry(LIMIT, 5);
    const now = localInstant(dayOf(5));

    const missed = await edit(app, now, given.andrea, entry, { value: { kind: "missed" } });
    expect(missed).toEqual({
      ok: false,
      error: { kind: "MissedNotAllowed", reason: "limitDirection" },
    });
    const decimal = await edit(app, now, given.andrea, entry, {
      value: { kind: "quantity", value: "1.5" },
    });
    expect(decimal).toEqual({
      ok: false,
      error: { kind: "InvalidQuantity", reason: "integerOnly" },
    });
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("rejects a note over 280 characters, counting code points, and accepts exactly 280 (B6)", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const now = localInstant(dayOf(5));
    const tooLong = { ok: false, error: { kind: "NoteTooLong" } };

    const ascii = await edit(app, now, given.andrea, entry, {
      note: "x".repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(ascii).toEqual(tooLong);
    const emoji = await edit(app, now, given.andrea, entry, {
      note: "😀".repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(emoji).toEqual(tooLong);
    expect(await stored(app, entry)).toEqual(entry);

    const exact = await edit(app, now, given.andrea, entry, { note: "😀".repeat(MAX_NOTE_LENGTH) });
    expect(exact.ok).toBe(true);
  });
});

describe("editEntry: concurrency (D5)", () => {
  it("two concurrent edits: the second to commit conflicts and the first one's edit stands", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const now = localInstant(dayOf(5));

    const { winner, loser } = await raceTransactions(
      app,
      (a) => edit(a, now, given.andrea, entry, { note: "winner" }),
      (a) => edit(a, now, given.andrea, entry, { note: "loser" }),
      "circles",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expectConflict(loser);
    expect((await stored(app, entry))?.note).toBe("winner");
  });

  it("a member leaving first makes the in-flight edit conflict and change nothing", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, given.andrea, { circleId: given.circle.id }),
      (a) => edit(a, localInstant(dayOf(5)), given.andrea, entry),
      "circles",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expectConflict(loser);
    expect(await stored(app, entry)).toEqual(entry);
  });

  it("a delete committed first makes the in-flight edit conflict and the entry stays deleted", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);
    const now = localInstant(dayOf(5));

    const { winner, loser } = await raceTransactions(
      app,
      (a) => deleteEntry(atInstant(a, now), given.andrea, { entryId: entry.id }),
      (a) => edit(a, now, given.andrea, entry),
      "circles",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expectConflict(loser);
    expect(await stored(app, entry)).toBeNull();
    const tombstone = await app.uow.read((repos) =>
      repos.entries.findByClientRequest(entry.memberId, entry.commitmentId, entry.clientRequestId),
    );
    expect(tombstone).toEqual({ ...entry, deleted: true, version: 1 });
  });

  it("a season change first makes the in-flight edit conflict and change nothing", async () => {
    const { app, given, entry } = await givenRecordedEntry(PER_DAY_REACH, 5);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => changeSeason(a, given.season),
      (a) => edit(a, localInstant(dayOf(5)), given.andrea, entry),
      "circles",
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect(await stored(app, entry)).toEqual(entry);
  });
});
