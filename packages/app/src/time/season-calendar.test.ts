import { graceDeadline, seasonDay } from "@pactjoy/engine";
import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";
import { localDate, localDateOfEpochDay } from "./local-date.ts";
import { localDateOfSeasonDay, toSeasonDay } from "./season-calendar.ts";

/** epochDay of 2500-12-31, same wide-range ceiling as local-date.test.ts's property. */
const MAX_EPOCH_DAY_2500 = 193_943;

describe("toSeasonDay", () => {
  it("SC-1: returns the 0-based offset from the season start", () => {
    const seasonStart = localDate("2026-10-01");

    expect(toSeasonDay(localDate("2026-10-03"), seasonStart)).toEqual({ kind: "day", day: 2 });
  });

  it("returns day 0 on the season's start date itself", () => {
    const seasonStart = localDate("2026-10-01");

    expect(toSeasonDay(seasonStart, seasonStart)).toEqual({ kind: "day", day: 0 });
  });

  it("returns beforeStart for a date earlier than the season start", () => {
    const seasonStart = localDate("2026-10-01");

    expect(toSeasonDay(localDate("2026-09-30"), seasonStart)).toEqual({ kind: "beforeStart" });
  });

  it("SC-5b: is deterministic -- the same pair always returns an identical SeasonDay", () => {
    const seasonStart = localDate("2026-10-01");
    const date = localDate("2026-10-03");

    expect(toSeasonDay(date, seasonStart)).toEqual(toSeasonDay(date, seasonStart));
  });

  it("SC-6: has no zone parameter at all -- the season's own resolved LocalDate is the only input, regardless of which member's real timezone produced it", () => {
    const seasonStart = localDate("2026-10-01");
    // Whichever member's real timezone produced this LocalDate upstream
    // (adapters/intl-time-zone.test.ts), the conversion here is identical.
    const localDateFromAnyMember = localDate("2026-10-03");

    expect(toSeasonDay(localDateFromAnyMember, seasonStart)).toEqual({ kind: "day", day: 2 });
  });
});

describe("localDateOfSeasonDay (inverse of toSeasonDay)", () => {
  it("round-trips through toSeasonDay for a range of days", () => {
    const seasonStart = localDate("2026-10-01");

    for (const day of [0, 1, 2, 7, 27]) {
      const asLocalDate = localDateOfSeasonDay(seasonDay(day), seasonStart);
      expect(toSeasonDay(asLocalDate, seasonStart)).toEqual({ kind: "day", day });
    }
  });

  it("crosses a month boundary correctly", () => {
    const seasonStart = localDate("2026-10-25");

    expect(localDateOfSeasonDay(seasonDay(10), seasonStart)).toBe(localDate("2026-11-04"));
  });
});

describe("toSeasonDay <-> localDateOfSeasonDay round-trip (property-based, fast-check)", () => {
  it("round-trips for any season start (1970-2500) and any non-negative day offset (up to 10 years)", () => {
    assert(
      property(
        integer({ min: 0, max: MAX_EPOCH_DAY_2500 }),
        integer({ min: 0, max: 3650 }),
        (seasonStartEpochDay, day) => {
          const seasonStart = localDateOfEpochDay(seasonStartEpochDay);
          const asLocalDate = localDateOfSeasonDay(seasonDay(day), seasonStart);

          expect(toSeasonDay(asLocalDate, seasonStart)).toEqual({ kind: "day", day });
        },
      ),
    );
  });
});

describe("grace deadline boundary (SC-5, SC-7 -- via engine's own graceDeadline)", () => {
  it("SC-5: on time recorded through the deadline day, late the day after", () => {
    const periodEnd = seasonDay(5);
    const deadline = graceDeadline(periodEnd);

    expect(deadline).toBe(seasonDay(6));
    expect(seasonDay(6) <= deadline).toBe(true);
    expect(seasonDay(7) <= deadline).toBe(false);
  });

  it("SC-7: a weeklyTotal commitment's week-close grace extends through the day after the week's last day", () => {
    const weekLastDay = seasonDay(6);

    expect(graceDeadline(weekLastDay)).toBe(seasonDay(7));
  });
});
