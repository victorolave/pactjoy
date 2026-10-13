import { describe, expect, it } from "vitest";
import { createIntlTimeZone } from "../../adapters/intl-time-zone.ts";
import { circleId, seasonId } from "../../shared/ids.ts";
import { seasonFixture } from "../../testing/builders.ts";
import { createFixedClock } from "../../testing/fixed-clock.ts";
import { instant } from "../../time/instant.ts";
import { localDate } from "../../time/local-date.ts";
import { timeZoneId } from "../../time/time-zone.port.ts";
import { closeDatesOf, seasonCloseCalendar, seasonCloseDay } from "./season-calendar.ts";

describe("seasonCloseCalendar", () => {
  it.each([4, 6, 8, 12] as const)(
    "L=%i: grace day L*7+1, results L*7+2, the circle may move on from L*7+8",
    (weeks) => {
      expect(seasonCloseCalendar(weeks)).toEqual({
        lastDay: weeks * 7,
        graceDay: weeks * 7 + 1,
        resultsFrom: weeks * 7 + 2,
        staleFrom: weeks * 7 + 8,
      });
    },
  );
});

const season = (tz: string, weeks: 4 | 6 | 8 | 12 = 4) =>
  seasonFixture({
    id: seasonId("season-1"),
    circleId: circleId("circle-1"),
    timeZone: timeZoneId(tz),
    actualStart: localDate("2026-09-08"),
    status: "active",
    lengthWeeks: weeks,
  });

// Noon in Bogota (17:00Z) on 1-based season day 1, 2026-09-08.
const DAY1_NOON_BOGOTA = 1_788_886_800_000;

describe("seasonCloseDay", () => {
  const zone = createIntlTimeZone();
  // 2026-10-05T23:30:00Z: Oct 5 in Bogota (UTC-5), already Oct 6 in Auckland (UTC+13).
  const clock = createFixedClock(instant(1_791_243_000_000));

  it("counts 1-based season days in the SEASON's time zone, not the server's", () => {
    expect(seasonCloseDay(season("America/Bogota"), clock.now(), zone)).toEqual({
      kind: "day",
      day: 28,
    });
    expect(seasonCloseDay(season("Pacific/Auckland"), clock.now(), zone)).toEqual({
      kind: "day",
      day: 29,
    });
  });

  it("is beforeStart without a start day, and before day 1", () => {
    expect(
      seasonCloseDay({ ...season("America/Bogota"), actualStart: null }, clock.now(), zone),
    ).toEqual({ kind: "beforeStart" });
    const early = createFixedClock(instant(1_788_264_000_000));
    expect(seasonCloseDay(season("America/Bogota"), early.now(), zone)).toEqual({
      kind: "beforeStart",
    });
  });

  it.each([4, 6, 8, 12] as const)(
    "L=%i: the days around the end map to the calendar rows",
    (weeks) => {
      const s = season("America/Bogota", weeks);
      const calendar = seasonCloseCalendar(weeks);
      // Noon Bogota (17:00Z) on 1-based day n, from day 1 = 2026-09-08.
      const noonOf = (n: number) => instant(DAY1_NOON_BOGOTA + (n - 1) * 86_400_000);
      for (const [n, day] of [
        [calendar.lastDay, weeks * 7],
        [calendar.graceDay, weeks * 7 + 1],
        [calendar.resultsFrom, weeks * 7 + 2],
        [calendar.lastDay + 7, weeks * 7 + 7],
        [calendar.staleFrom, weeks * 7 + 8],
      ] as const) {
        expect(seasonCloseDay(s, noonOf(n), zone)).toEqual({ kind: "day", day });
      }
    },
  );
});

describe("closeDatesOf", () => {
  it("gives the civil dates results open and the circle may move on (L=4 from 2026-09-08)", () => {
    expect(closeDatesOf(season("America/Bogota"))).toEqual({
      resultsOn: "2026-10-07",
      staleOn: "2026-10-13",
    });
  });

  it("is null for a season that has not started", () => {
    expect(closeDatesOf({ ...season("America/Bogota"), actualStart: null })).toBeNull();
  });
});
