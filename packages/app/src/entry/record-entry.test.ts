import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  END_OF_DAY,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { localDate } from "../time/local-date.ts";
import { deleteEntry } from "./delete-entry.ts";
import { editEntry } from "./edit-entry.ts";
import { MAX_CLIENT_REQUEST_ID_LENGTH, MAX_NOTE_LENGTH } from "./entry.ts";
import { type RecordEntryInput, recordEntry } from "./record-entry.ts";

// Season day 0 is 2026-10-01 (UTC-3 fixed zone), so 2026-10-03 is day 2.
const DAY = (n: number) => localDate(`2026-10-${String(1 + n).padStart(2, "0")}`);
const PER_DAY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const WEEKLY_TOTAL: Measure = { ...PER_DAY_REACH, schedule: { period: "weeklyTotal" } };
const LIMIT: Measure = {
  unit: "times",
  customLabel: null,
  precision: "integer",
  target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
  schedule: PER_DAY_REACH.schedule,
};

function newApp(date = DAY(2), msIntoDay?: number): TestApp {
  return createTestApp({ now: localInstant(date, msIntoDay), timeZone: fixtureTimeZone });
}

function input(
  given: {
    season: { id: RecordEntryInput["seasonId"] };
    andreaCommitment: RecordEntryInput["commitmentId"];
  },
  overrides: Partial<RecordEntryInput> = {},
): RecordEntryInput {
  return {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    value: { kind: "quantity", value: "30" },
    clientRequestId: "req-1",
    ...overrides,
  };
}

async function stored(app: TestApp, given: { season: { id: RecordEntryInput["seasonId"] } }) {
  return app.uow.read((repos) => repos.entries.listBySeason(given.season.id));
}

describe("recordEntry: recording", () => {
  it("stores the entry as entered, for today, with the season day and instant (ER-17)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const result = await recordEntry(
      app,
      given.andrea,
      input(given, { value: { kind: "quantity", value: "60" }, note: "felt great" }),
    );

    expect(result.ok).toBe(true);
    const entries = await stored(app, given);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      day: 2,
      recordedOn: 2,
      recordedAt: localInstant(DAY(2)),
      value: { kind: "quantity", value: fromInt(60) },
      note: "felt great",
      clientRequestId: "req-1",
      editedAt: null,
    });
    expect(result.ok && result.value).toEqual({ entry: entries[0], replayed: false });
  });

  it("records for an earlier day inside its grace, keeping recordedOn as today", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const result = await recordEntry(app, given.andrea, input(given, { forDate: DAY(1) }));

    expect(result.ok).toBe(true);
    expect((await stored(app, given))[0]).toMatchObject({ day: 1, recordedOn: 2 });
  });

  it("sums nothing itself: two entries the same day are both kept (ER-4 is computed by the engine)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    await recordEntry(
      app,
      given.andrea,
      input(given, { value: { kind: "quantity", value: "15" }, clientRequestId: "a" }),
    );
    await recordEntry(
      app,
      given.andrea,
      input(given, { value: { kind: "quantity", value: "15" }, clientRequestId: "b" }),
    );

    expect(await stored(app, given)).toHaveLength(2);
  });

  it("accepts missed on a day-bound reach commitment (ER-5) and an explicit 0 on limit (ER-20)", async () => {
    const reach = newApp();
    const a = await givenActiveSeason(reach, PER_DAY_REACH);
    expect((await recordEntry(reach, a.andrea, input(a, { value: { kind: "missed" } }))).ok).toBe(
      true,
    );

    const limit = newApp();
    const b = await givenActiveSeason(limit, LIMIT);
    expect(
      (await recordEntry(limit, b.andrea, input(b, { value: { kind: "quantity", value: "0" } })))
        .ok,
    ).toBe(true);
    expect((await stored(limit, b))[0]?.value).toEqual({ kind: "quantity", value: fromInt(0) });
  });

  it("rejects an invalid value and stores nothing: missed on limit (ER-6) and on week-bound (ER-7)", async () => {
    const limit = newApp();
    const a = await givenActiveSeason(limit, LIMIT);
    expect(await recordEntry(limit, a.andrea, input(a, { value: { kind: "missed" } }))).toEqual({
      ok: false,
      error: { kind: "MissedNotAllowed", reason: "limitDirection" },
    });
    expect(await stored(limit, a)).toEqual([]);

    const weekly = newApp();
    const b = await givenActiveSeason(weekly, WEEKLY_TOTAL);
    expect(await recordEntry(weekly, b.andrea, input(b, { value: { kind: "missed" } }))).toEqual({
      ok: false,
      error: { kind: "MissedNotAllowed", reason: "weekBound" },
    });
  });

  it("counts the note in characters, not UTF-16 units (B6)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const emoji = await recordEntry(
      app,
      given.andrea,
      input(given, { note: "😀".repeat(MAX_NOTE_LENGTH) }),
    );
    expect(emoji.ok).toBe(true);
    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { note: "😀".repeat(MAX_NOTE_LENGTH + 1), clientRequestId: "r2" }),
      ),
    ).toEqual({ ok: false, error: { kind: "NoteTooLong" } });
  });

  it("rejects a note over 280 characters (B6) and accepts exactly 280", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const tooLong = await recordEntry(
      app,
      given.andrea,
      input(given, { note: "x".repeat(MAX_NOTE_LENGTH + 1) }),
    );
    expect(tooLong).toEqual({ ok: false, error: { kind: "NoteTooLong" } });
    const exact = await recordEntry(
      app,
      given.andrea,
      input(given, { note: "x".repeat(MAX_NOTE_LENGTH) }),
    );
    expect(exact.ok).toBe(true);
  });
});

describe("recordEntry: day bounds and grace", () => {
  it("rejects a future day (ER-2)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    expect(await recordEntry(app, given.andrea, input(given, { forDate: DAY(3) }))).toEqual({
      ok: false,
      error: { kind: "FutureDay" },
    });
    expect(await stored(app, given)).toEqual([]);
  });

  it("rejects a day before the actual start, including when today is before it (ER-3)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const before = { ok: false, error: { kind: "BeforeSeasonStart" } };

    expect(
      await recordEntry(app, given.andrea, input(given, { forDate: localDate("2026-09-30") })),
    ).toEqual(before);

    const early = newApp(localDate("2026-09-30"));
    const other = await givenActiveSeason(early, PER_DAY_REACH);
    expect(await recordEntry(early, other.andrea, input(other))).toEqual(before);
  });

  it("uses the shifted actual start for day 0 (A10)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save({ ...given.season, actualStart: DAY(2), version: 1 }, 0);
      return { ok: true, value: undefined };
    });

    expect((await recordEntry(app, given.andrea, input(given, { forDate: DAY(1) }))).ok).toBe(
      false,
    );
    await recordEntry(app, given.andrea, input(given, { forDate: DAY(2) }));
    expect((await stored(app, given))[0]?.day).toBe(seasonDay(0));
  });

  it("accepts a per-session entry at the last instant of the next day and rejects the first instant after (ER-8, ER-9)", async () => {
    const seed = newApp();
    const given = await givenActiveSeason(seed, PER_DAY_REACH);

    const onTime = atInstant(seed, localInstant(DAY(6), END_OF_DAY));
    expect((await recordEntry(onTime, given.andrea, input(given, { forDate: DAY(5) }))).ok).toBe(
      true,
    );

    const late = atInstant(seed, localInstant(DAY(7), 0));
    expect(
      await recordEntry(
        late,
        given.andrea,
        input(given, { forDate: DAY(5), clientRequestId: "late" }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("keeps a week-bound window open through the week's last day plus grace (A9, SC-7)", async () => {
    const seed = newApp();
    const given = await givenActiveSeason(seed, WEEKLY_TOTAL);

    const weekGrace = atInstant(seed, localInstant(DAY(7), END_OF_DAY));
    expect((await recordEntry(weekGrace, given.andrea, input(given, { forDate: DAY(1) }))).ok).toBe(
      true,
    );

    const late = atInstant(seed, localInstant(DAY(8), 0));
    expect(
      await recordEntry(
        late,
        given.andrea,
        input(given, { forDate: DAY(1), clientRequestId: "late" }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("rejects a day past the season's last day", async () => {
    const app = newApp(DAY(29));
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    expect(await recordEntry(app, given.andrea, input(given))).toEqual({
      ok: false,
      error: { kind: "OutsideSeason" },
    });
  });
});

describe("recordEntry: who and when", () => {
  it("rejects an entry for another member's commitment (ER-18) and an unknown commitment", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    expect(await recordEntry(app, given.victor, input(given))).toEqual({
      ok: false,
      error: { kind: "CommitmentNotOwned" },
    });
    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { commitmentId: "nope" as typeof given.andreaCommitment }),
      ),
    ).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
    expect(await stored(app, given)).toEqual([]);
  });

  it("rejects a non-member and an unknown season", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const stranger = { userId: "user-stranger" as typeof given.andrea.userId };

    expect(await recordEntry(app, stranger, input(given))).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { seasonId: "nope" as typeof given.season.id }),
      ),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("rejects a member who left, keeping their past entries (ER-21, B9)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, input(given));
    await app.uow.transaction(async (repos) => {
      const left = {
        ...given.circle,
        members: given.circle.members.map((m) =>
          m.userId === given.andrea.userId ? { ...m, status: "left" as const } : m,
        ),
        version: 1,
      };
      await repos.circles.save(left, 0);
      return { ok: true, value: undefined };
    });

    expect(
      await recordEntry(app, given.andrea, input(given, { clientRequestId: "after" })),
    ).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(await stored(app, given)).toHaveLength(1);
  });

  it("rejects entries while the pact is open or after the season closed", async () => {
    for (const status of ["pactOpen", "closed"] as const) {
      const app = newApp();
      const given = await givenActiveSeason(app, PER_DAY_REACH, status);
      expect(await recordEntry(app, given.andrea, input(given))).toEqual({
        ok: false,
        error: { kind: "SeasonNotActive" },
      });
    }
  });
});

describe("recordEntry: idempotency (T1, ER-16)", () => {
  it("replays the original entry instead of duplicating, even after its window closed", async () => {
    const seed = newApp();
    const given = await givenActiveSeason(seed, PER_DAY_REACH);
    const first = await recordEntry(seed, given.andrea, input(given));

    const later = atInstant(seed, localInstant(DAY(9)));
    const second = await recordEntry(later, given.andrea, input(given));

    expect(first.ok && second.ok && second.value.entry).toEqual(first.ok && first.value.entry);
    expect(second.ok && second.value.replayed).toBe(true);
    expect(await stored(seed, given)).toHaveLength(1);
  });

  it("rejects a replayed key with a different payload (value, note or day) and keeps the original", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, input(given, { note: "a" }));
    const reused = { ok: false, error: { kind: "IdempotencyKeyReused" } };

    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { note: "a", value: { kind: "quantity", value: "31" } }),
      ),
    ).toEqual(reused);
    expect(await recordEntry(app, given.andrea, input(given, { note: "b" }))).toEqual(reused);
    expect(
      await recordEntry(app, given.andrea, input(given, { note: "a", forDate: DAY(1) })),
    ).toEqual(reused);
    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { note: "a", value: { kind: "quantity", value: "abc" } }),
      ),
    ).toEqual(reused);
    const same = await recordEntry(app, given.andrea, input(given, { note: "a", forDate: DAY(2) }));
    expect(same.ok && same.value.replayed).toBe(true);
    expect(await stored(app, given)).toHaveLength(1);
  });

  it("tells 0.5 from 1 and done from missed: the fingerprint keeps the whole fraction and the kind", async () => {
    const half = newApp();
    const a = await givenActiveSeason(half, PER_DAY_REACH);
    await recordEntry(half, a.andrea, input(a, { value: { kind: "quantity", value: "0.5" } }));
    expect(
      await recordEntry(half, a.andrea, input(a, { value: { kind: "quantity", value: "1" } })),
    ).toEqual({ ok: false, error: { kind: "IdempotencyKeyReused" } });

    const done = newApp();
    const b = await givenActiveSeason(done, {
      unit: "done",
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    await recordEntry(done, b.andrea, input(b, { value: { kind: "done" } }));
    expect(await recordEntry(done, b.andrea, input(b, { value: { kind: "missed" } }))).toEqual({
      ok: false,
      error: { kind: "IdempotencyKeyReused" },
    });
  });

  it("compares quantities by exact value, so 2.0, 2 and 2.00 are the same payload", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(
      app,
      given.andrea,
      input(given, { value: { kind: "quantity", value: "2.0" } }),
    );

    for (const value of ["2", "2.00"]) {
      const again = await recordEntry(
        app,
        given.andrea,
        input(given, { value: { kind: "quantity", value } }),
      );
      expect(again.ok && again.value.replayed).toBe(true);
    }
    expect(
      await recordEntry(
        app,
        given.andrea,
        input(given, { value: { kind: "quantity", value: "2.5" } }),
      ),
    ).toEqual({ ok: false, error: { kind: "IdempotencyKeyReused" } });
    expect(await stored(app, given)).toHaveLength(1);
  });

  it("treats an omitted note and an explicit null note as the same payload", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, input(given));
    const again = await recordEntry(app, given.andrea, input(given, { note: null }));
    expect(again.ok && again.value.replayed).toBe(true);
  });

  it("replaying the ORIGINAL request after an edit succeeds and returns the current entry", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const first = await recordEntry(app, given.andrea, input(given, { note: "a" }));
    const id = first.ok ? first.value.entry.id : entryId("?");
    const edited = await editEntry(app, given.andrea, {
      entryId: id,
      value: { kind: "quantity", value: "45" },
      note: "b",
    });

    const replay = await recordEntry(app, given.andrea, input(given, { note: "a" }));

    expect(replay).toEqual({
      ok: true,
      value: { entry: edited.ok && edited.value.entry, replayed: true },
    });
    expect(await stored(app, given)).toHaveLength(1);
  });

  it("the edited payload is NOT the original: sending it under the same key is IdempotencyKeyReused", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const first = await recordEntry(app, given.andrea, input(given));
    await editEntry(app, given.andrea, {
      entryId: first.ok ? first.value.entry.id : entryId("?"),
      value: { kind: "quantity", value: "45" },
      note: null,
    });

    const edited = input(given, { value: { kind: "quantity", value: "45" } });
    expect(await recordEntry(app, given.andrea, edited)).toEqual({
      ok: false,
      error: { kind: "IdempotencyKeyReused" },
    });
  });

  it("replaying the key of a deleted entry returns EntryDeleted and does not recreate it", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const first = await recordEntry(app, given.andrea, input(given));
    await deleteEntry(app, given.andrea, {
      entryId: first.ok ? first.value.entry.id : entryId("?"),
    });

    expect(await recordEntry(app, given.andrea, input(given))).toEqual({
      ok: false,
      error: { kind: "EntryDeleted" },
    });
    expect(await stored(app, given)).toEqual([]);
  });

  it("a deleted key reused with a different payload is still IdempotencyKeyReused", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    const first = await recordEntry(app, given.andrea, input(given));
    await deleteEntry(app, given.andrea, {
      entryId: first.ok ? first.value.entry.id : entryId("?"),
    });

    const other = input(given, { value: { kind: "quantity", value: "31" } });
    expect(await recordEntry(app, given.andrea, other)).toEqual({
      ok: false,
      error: { kind: "IdempotencyKeyReused" },
    });
  });

  it("rejects an empty or over-long clientRequestId", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    expect(await recordEntry(app, given.andrea, input(given, { clientRequestId: "" }))).toEqual({
      ok: false,
      error: { kind: "InvalidClientRequestId", reason: "empty" },
    });
    const long = "k".repeat(MAX_CLIENT_REQUEST_ID_LENGTH + 1);
    expect(await recordEntry(app, given.andrea, input(given, { clientRequestId: long }))).toEqual({
      ok: false,
      error: { kind: "InvalidClientRequestId", reason: "tooLong" },
    });
    const emojis = "😀".repeat(MAX_CLIENT_REQUEST_ID_LENGTH);
    expect(
      (await recordEntry(app, given.andrea, input(given, { clientRequestId: emojis }))).ok,
    ).toBe(true);
    expect(
      await recordEntry(app, given.andrea, input(given, { clientRequestId: `${emojis}😀` })),
    ).toEqual({ ok: false, error: { kind: "InvalidClientRequestId", reason: "tooLong" } });
    const exact = "k".repeat(MAX_CLIENT_REQUEST_ID_LENGTH);
    expect(
      (await recordEntry(app, given.andrea, input(given, { clientRequestId: exact }))).ok,
    ).toBe(true);
  });

  it("scopes the key to (member, commitment): another actor or commitment is not a replay", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, input(given));

    const other = await recordEntry(
      app,
      given.victor,
      input(given, { commitmentId: given.victorCommitment, value: { kind: "done" } }),
    );

    expect(other.ok && other.value.replayed).toBe(false);
    expect(await stored(app, given)).toHaveLength(2);
  });

  it("resolves a duplicate that commits second as a replay of the winner's entry", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => recordEntry(a, given.andrea, input(given)),
      (a) => recordEntry(a, given.andrea, input(given)),
    );

    expect(winner).toMatchObject({
      status: "fulfilled",
      value: { ok: true, value: { replayed: false } },
    });
    expect(loser).toMatchObject({
      status: "fulfilled",
      value: { ok: true, value: { replayed: true } },
    });
    expect(await stored(app, given)).toHaveLength(1);
  });

  it("loses a true concurrent duplicate on the unique key: the loser conflicts and only one entry exists", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => recordEntry(a, given.andrea, input(given)),
      (a) => recordEntry(a, given.andrea, input(given)),
      "entries",
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored(app, given)).toHaveLength(1);
  });
});

describe("recordEntry: read-set validation (D5)", () => {
  it("a member leaving first makes the in-flight recordEntry conflict and record nothing (B9)", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, given.andrea, { circleId: given.circle.id }),
      (a) => recordEntry(a, given.andrea, input(given)),
      "entries",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(loser.status).toBe("rejected");
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored(app, given)).toEqual([]);
  });

  it("a season change first makes the in-flight recordEntry conflict and record nothing", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const { winner, loser } = await raceTransactions(
      app,
      (a) =>
        a.uow.transaction(async (repos) => {
          await repos.seasons.save({ ...given.season, version: 1 }, 0);
          return { ok: true as const, value: undefined };
        }),
      (a) => recordEntry(a, given.andrea, input(given)),
      "entries",
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored(app, given)).toEqual([]);
  });

  it("a pure replay is not hit by an unrelated circle or season version bump", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);
    await recordEntry(app, given.andrea, input(given));

    const { winner, loser } = await raceTransactions(
      app,
      (a) =>
        a.uow.transaction(async (repos) => {
          await repos.seasons.save({ ...given.season, version: 1 }, 0);
          await repos.circles.save({ ...given.circle, version: 1 }, 0);
          return { ok: true as const, value: undefined };
        }),
      (a) => recordEntry(a, given.andrea, input(given)),
      "entries",
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser).toMatchObject({
      status: "fulfilled",
      value: { ok: true, value: { replayed: true } },
    });
  });

  it("does not conflict when nothing it read has changed", async () => {
    const app = newApp();
    const given = await givenActiveSeason(app, PER_DAY_REACH);

    const { winner, loser } = await raceTransactions(
      app,
      (a) =>
        recordEntry(
          a,
          given.victor,
          input(given, { commitmentId: given.victorCommitment, value: { kind: "done" } }),
        ),
      (a) => recordEntry(a, given.andrea, input(given)),
      "entries",
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(loser).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(await stored(app, given)).toHaveLength(2);
  });
});
