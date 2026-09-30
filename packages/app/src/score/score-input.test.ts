import { type CommitmentId, fromInt, type MemberId, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord } from "../entry/entry.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { circleId, entryId, habitId, seasonId } from "../shared/ids.ts";
import { seasonFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { startWeekdayOf, toScoreInput } from "./score-input.ts";

const ANDREA = "member-andrea" as MemberId;
const VICTOR = "member-victor" as MemberId;
const DONE = {
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
} as const;

function commitmentOf(id: string, memberId: MemberId, weightPercent = 100) {
  return buildCommitment({
    id: commitmentId(id),
    memberId,
    habitId: habitId(`habit-${id}`),
    weightPercent,
    privacy: "visible",
    measure: DONE,
  });
}

function entryOf(
  id: string,
  memberId: MemberId,
  commitment: CommitmentId,
  value: EntryRecord["value"],
  day = 1,
): EntryRecord {
  return {
    id: entryId(id),
    seasonId: seasonId("season-1"),
    memberId,
    commitmentId: commitment,
    day: seasonDay(day),
    recordedOn: seasonDay(day + 1),
    recordedAt: instant(0),
    value,
    note: "private note",
    clientRequestId: id,
    editedAt: null,
    version: 0,
    requestFingerprint: "fingerprint",
    deleted: false,
  };
}

describe("startWeekdayOf", () => {
  it.each([
    ["2026-10-05", 0], // Monday
    ["2026-10-01", 3], // Thursday
    ["2026-10-04", 6], // Sunday
    ["1970-01-01", 3], // epoch day 0, Thursday
    ["2026-10-07", 2], // Wednesday, wraps past the epoch weekday
  ])("%s is weekday %i (Monday = 0)", (date, weekday) => {
    expect(startWeekdayOf(localDate(date))).toBe(weekday);
  });
});

describe("toScoreInput", () => {
  const season = seasonFixture({
    id: seasonId("season-1"),
    circleId: circleId("circle-1"),
    lengthWeeks: 6,
    commitments: [
      commitmentOf("c-andrea-1", ANDREA, 60),
      commitmentOf("c-andrea-2", ANDREA, 40),
      commitmentOf("c-victor", VICTOR),
    ],
  });
  const andrea1 = commitmentId("c-andrea-1");
  const victor = commitmentId("c-victor");

  function build(entries: readonly EntryRecord[], pauses: readonly MemberPauseRequest[] = []) {
    return toScoreInput({
      season,
      actualStart: localDate("2026-10-01"),
      memberId: ANDREA,
      entries,
      pauses,
      today: seasonDay(9),
    });
  }

  it("carries the season shape, today and only the member's own commitments", () => {
    const input = build([]);

    expect(input.season).toEqual({ lengthWeeks: 6, startWeekday: 3 });
    expect(input.today).toBe(9);
    expect(input.commitments.map((c) => c.id)).toEqual(["c-andrea-1", "c-andrea-2"]);
    expect(input.commitments.map((c) => c.weightPercent)).toEqual([60, 40]);
  });

  it("maps stored entries one to one, dropping what the engine does not know, and never fills gaps", () => {
    const input = build([
      entryOf("e1", ANDREA, andrea1, { kind: "done" }, 1),
      entryOf("e2", ANDREA, andrea1, { kind: "quantity", value: fromInt(0) }, 2),
      entryOf("e3", ANDREA, andrea1, { kind: "missed" }, 3),
    ]);

    expect(input.entries).toEqual([
      { commitmentId: andrea1, day: 1, recordedOn: 2, kind: "done" },
      { commitmentId: andrea1, day: 2, recordedOn: 3, kind: "quantity", value: fromInt(0) },
      { commitmentId: andrea1, day: 3, recordedOn: 4, kind: "missed" },
    ]);
  });

  it("keeps only the member's own entries and pauses", () => {
    const pause = (memberId: MemberId, commitmentId: CommitmentId): MemberPauseRequest => ({
      memberId,
      commitmentId,
      requestedOn: seasonDay(1),
      startDay: seasonDay(2),
      end: { kind: "open" },
      decision: { kind: "pending" },
    });

    const input = build(
      [
        entryOf("e1", ANDREA, andrea1, { kind: "done" }),
        entryOf("e2", VICTOR, victor, { kind: "done" }),
      ],
      [pause(ANDREA, andrea1), pause(VICTOR, victor)],
    );

    expect(input.entries).toHaveLength(1);
    expect(input.entries[0]?.commitmentId).toBe(andrea1);
    expect(input.pauses).toHaveLength(1);
    expect(input.pauses[0]?.commitmentId).toBe(andrea1);
  });

  it("hands the engine a pause without the app-only member id", () => {
    const input = build(
      [],
      [
        {
          memberId: ANDREA,
          commitmentId: andrea1,
          requestedOn: seasonDay(1),
          startDay: seasonDay(2),
          end: { kind: "fixed", lastDay: seasonDay(4) },
          decision: { kind: "pending" },
        },
      ],
    );

    expect(input.pauses[0]).not.toHaveProperty("memberId");
  });
});
