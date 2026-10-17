import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { createIntlTimeZone } from "./intl-time-zone.ts";

/**
 * Row fixtures generated against Node's own `Intl`/tz database (design
 * #4812's verified facts: Node ICU, tz 2026a), not hand-computed -- DST
 * transition instants are exact, not approximate.
 */
const ROWS: ReadonlyArray<{
  readonly label: string;
  readonly epochMs: number;
  readonly zone: string;
  readonly expected: string;
}> = [
  {
    label: "Madrid spring-forward (SC-3): just before the skipped hour",
    epochMs: Date.UTC(2026, 2, 29, 0, 59, 59, 999),
    zone: "Europe/Madrid",
    expected: "2026-03-29",
  },
  {
    label: "Madrid spring-forward (SC-3): right after the skipped hour, same day",
    epochMs: Date.UTC(2026, 2, 29, 1, 0, 0, 0),
    zone: "Europe/Madrid",
    expected: "2026-03-29",
  },
  {
    label: "Madrid fall-back (SC-4): first pass through the repeated local hour",
    epochMs: Date.UTC(2026, 9, 25, 0, 30, 0, 0),
    zone: "Europe/Madrid",
    expected: "2026-10-25",
  },
  {
    label: "Madrid fall-back (SC-4): second pass through the repeated local hour",
    epochMs: Date.UTC(2026, 9, 25, 1, 30, 0, 0),
    zone: "Europe/Madrid",
    expected: "2026-10-25",
  },
  {
    label: "Santiago skipped midnight: just before the transition",
    epochMs: Date.UTC(2026, 8, 6, 3, 59, 59, 999),
    zone: "America/Santiago",
    expected: "2026-09-05",
  },
  {
    label: "Santiago skipped midnight: right after (local midnight itself never occurs)",
    epochMs: Date.UTC(2026, 8, 6, 4, 0, 0, 0),
    zone: "America/Santiago",
    expected: "2026-09-06",
  },
  {
    label: "Bogota (no DST): 23:59:59.999 local vs 00:00:00.000 local (SC-2)",
    epochMs: Date.UTC(2026, 5, 15, 4, 59, 59, 999),
    zone: "America/Bogota",
    expected: "2026-06-14",
  },
  {
    label: "Bogota (no DST): the next local instant is a new day",
    epochMs: Date.UTC(2026, 5, 15, 5, 0, 0, 0),
    zone: "America/Bogota",
    expected: "2026-06-15",
  },
  {
    label: "Auckland (southern-hemisphere DST, +13 in January)",
    epochMs: Date.UTC(2026, 0, 15, 12, 0, 0, 0),
    zone: "Pacific/Auckland",
    expected: "2026-01-16",
  },
  {
    label: "Kiritimati (fixed UTC+14, no DST): just before local midnight",
    epochMs: Date.UTC(2026, 0, 1, 9, 59, 59, 999),
    zone: "Pacific/Kiritimati",
    expected: "2026-01-01",
  },
  {
    label: "Kiritimati (fixed UTC+14, no DST): at local midnight",
    epochMs: Date.UTC(2026, 0, 1, 10, 0, 0, 0),
    zone: "Pacific/Kiritimati",
    expected: "2026-01-02",
  },
];

describe("createIntlTimeZone", () => {
  const tz = createIntlTimeZone();

  it.each(ROWS)("$label", ({ epochMs, zone, expected }) => {
    expect(tz.localDateAt(instant(epochMs), timeZoneId(zone))).toBe(localDate(expected));
  });

  it("isValidZone accepts a real IANA identifier", () => {
    expect(tz.isValidZone("Europe/Madrid")).toBe(true);
  });

  it("isValidZone rejects an invalid identifier", () => {
    expect(tz.isValidZone("Not/AZone")).toBe(false);
  });

  it("isValidZone rejects an empty string", () => {
    expect(tz.isValidZone("")).toBe(false);
  });

  it("localDateAt throws RangeError for an invalid IANA zone", () => {
    expect(() => tz.localDateAt(instant(Date.now()), timeZoneId("Not/AZone"))).toThrow(RangeError);
  });
});

/** `localTimeAt`/`instantAt` (ADR-0017): wall-clock time for scheduled notices, DST included. */
describe("createIntlTimeZone local wall-clock time", () => {
  const tz = createIntlTimeZone();
  const madrid = timeZoneId("Europe/Madrid");
  const bogota = timeZoneId("America/Bogota");
  const santiago = timeZoneId("America/Santiago");

  it("localTimeAt gives the local date and minute of day", () => {
    // 2026-06-15T14:30Z is 09:30 in Bogota (UTC-5).
    expect(tz.localTimeAt(instant(Date.UTC(2026, 5, 15, 14, 30, 59, 999)), bogota)).toEqual({
      date: localDate("2026-06-15"),
      minuteOfDay: 9 * 60 + 30,
    });
    // 2026-06-14T22:00Z is 00:00 on the 15th in Madrid (UTC+2 in summer).
    expect(tz.localTimeAt(instant(Date.UTC(2026, 5, 14, 22, 0)), madrid)).toEqual({
      date: localDate("2026-06-15"),
      minuteOfDay: 0,
    });
  });

  it("instantAt maps a plain local time to its instant", () => {
    expect(tz.instantAt(localDate("2026-06-15"), 9 * 60, bogota)).toBe(
      instant(Date.UTC(2026, 5, 15, 14, 0)),
    );
    expect(tz.instantAt(localDate("2026-01-15"), 9 * 60, madrid)).toBe(
      instant(Date.UTC(2026, 0, 15, 8, 0)),
    );
    expect(tz.instantAt(localDate("2026-07-15"), 22 * 60, madrid)).toBe(
      instant(Date.UTC(2026, 6, 15, 20, 0)),
    );
  });

  it("instantAt shifts a time inside a spring-forward gap forward", () => {
    // Madrid 2026-03-29: 02:00 local jumps to 03:00 (01:00Z). 02:30 does not exist.
    expect(tz.instantAt(localDate("2026-03-29"), 2 * 60 + 30, madrid)).toBe(
      instant(Date.UTC(2026, 2, 29, 1, 30)),
    );
    // Santiago 2026-09-06: local midnight never occurs (00:00 -> 01:00 at 04:00Z).
    expect(tz.instantAt(localDate("2026-09-06"), 0, santiago)).toBe(
      instant(Date.UTC(2026, 8, 6, 4, 0)),
    );
  });

  it("instantAt takes the earlier instant of a repeated fall-back hour", () => {
    // Madrid 2026-10-25: 02:30 local happens at 00:30Z (CEST) and again at 01:30Z (CET).
    expect(tz.instantAt(localDate("2026-10-25"), 2 * 60 + 30, madrid)).toBe(
      instant(Date.UTC(2026, 9, 25, 0, 30)),
    );
  });

  it("instantAt round-trips through localTimeAt away from transitions", () => {
    for (const minute of [0, 480, 540, 1320, 1439]) {
      const at = tz.instantAt(localDate("2026-02-10"), minute, santiago);
      expect(tz.localTimeAt(at, santiago)).toEqual({
        date: localDate("2026-02-10"),
        minuteOfDay: minute,
      });
    }
  });

  it("instantAt rejects a minute of day outside [0, 1440)", () => {
    expect(() => tz.instantAt(localDate("2026-02-10"), 1440, madrid)).toThrow(RangeError);
  });
});
