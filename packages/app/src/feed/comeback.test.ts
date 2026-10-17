import { type SeasonDay, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { COMEBACK_GAP_DAYS, comebacksOf } from "./comeback.ts";
import { entryFor, meditar, minutes, missed } from "./feed-fixtures.ts";

const always = () => true;
const days = (comebacks: ReturnType<typeof comebacksOf>) => comebacks.map((c) => c.day);

describe("comebacksOf (ADR-0018, F6)", () => {
  it("pins the gap at 3 active days", () => {
    expect(COMEBACK_GAP_DAYS).toBe(3);
  });

  it("is the first entry after exactly 3 active days with no entry", () => {
    const entries = [entryFor(meditar(), 0), entryFor(meditar(), 4)];
    expect(days(comebacksOf({ entries, isActiveDay: always }))).toEqual([4]);
  });

  it("is not a comeback after 1 or 2 empty days", () => {
    expect(
      comebacksOf({
        entries: [entryFor(meditar(), 0), entryFor(meditar(), 2)],
        isActiveDay: always,
      }),
    ).toEqual([]);
    expect(
      comebacksOf({
        entries: [entryFor(meditar(), 0), entryFor(meditar(), 3)],
        isActiveDay: always,
      }),
    ).toEqual([]);
  });

  it("the first entry of the season is never a comeback", () => {
    expect(comebacksOf({ entries: [entryFor(meditar(), 9)], isActiveDay: always })).toEqual([]);
  });

  it("paused days do not count toward the gap", () => {
    // Days 1..4 are empty; 2, 3 and 4 are paused, so only 1 active day separates the entries.
    const entries = [entryFor(meditar(), 0), entryFor(meditar(), 5)];
    const isActiveDay = (day: SeasonDay) => day < 2 || day > 4;
    expect(comebacksOf({ entries, isActiveDay })).toEqual([]);
  });

  it("3 active days survive paused days around them", () => {
    // Days 1..6 are empty; 2 and 5 are paused, leaving the active days 1, 3, 4 and 6.
    const entries = [entryFor(meditar(), 0), entryFor(meditar(), 7)];
    const isActiveDay = (day: SeasonDay) => day !== 2 && day !== 5;
    expect(days(comebacksOf({ entries, isActiveDay }))).toEqual([7]);
  });

  it("a missed entry is presence: it resets the gap and is not a trigger itself", () => {
    // Done on 0, missed on 4, done on 8: the gap before 8 is 5, 6, 7 (3 days) -> a comeback on 8.
    const entries = [entryFor(meditar(), 0), missed(meditar(), 4), entryFor(meditar(), 8)];
    expect(days(comebacksOf({ entries, isActiveDay: always }))).toEqual([8]);
    // Done on 0, missed on 3, done on 5: only day 4 separates the last two -> none.
    const shorter = [entryFor(meditar(), 0), missed(meditar(), 3), entryFor(meditar(), 5)];
    expect(comebacksOf({ entries: shorter, isActiveDay: always })).toEqual([]);
  });

  it("a day with only a missed entry is not a comeback even after a long silence", () => {
    const entries = [entryFor(meditar(), 0), missed(meditar(), 8)];
    expect(comebacksOf({ entries, isActiveDay: always })).toEqual([]);
  });

  it("several entries on the comeback day are one comeback, at the earliest of them", () => {
    const first = minutes(meditar(), 6, "30", { id: "e-a", recordedAt: instant(2_000) });
    const second = minutes(meditar(), 6, "30", { id: "e-b", recordedAt: instant(1_000) });
    const result = comebacksOf({
      entries: [entryFor(meditar(), 0), first, second],
      isActiveDay: always,
    });
    expect(result).toEqual([{ day: seasonDay(6), at: instant(1_000) }]);
  });

  it("entries on different commitments of the member share the same presence", () => {
    // A leer entry on day 3 means the member was present: the gap before day 6 is only 4 and 5.
    const entries = [
      entryFor(meditar(), 0),
      entryFor({ ...meditar(), id: "other" as never }, 3),
      entryFor(meditar(), 6),
    ];
    expect(comebacksOf({ entries, isActiveDay: always })).toEqual([]);
  });

  it("each return after a silence is its own comeback", () => {
    const entries = [0, 5, 6, 12].map((day) => entryFor(meditar(), day));
    expect(days(comebacksOf({ entries, isActiveDay: always }))).toEqual([5, 12]);
  });

  it("is independent of the order of the entries", () => {
    const entries = [entryFor(meditar(), 5), entryFor(meditar(), 0)];
    expect(days(comebacksOf({ entries, isActiveDay: always }))).toEqual([5]);
  });
});
