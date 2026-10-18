import { describe, expect, it } from "vitest";
import { createFixedOffsetTimeZone } from "../testing/fixed-time-zone.ts";
import { instant } from "./instant.ts";
import type { LocalDate } from "./local-date.ts";
import { localDate } from "./local-date.ts";
import { timeZoneId } from "./time-zone.port.ts";

describe("timeZoneId", () => {
  it("brands a non-empty IANA identifier string", () => {
    expect(timeZoneId("Europe/Madrid")).toBe("Europe/Madrid");
  });

  it("rejects an empty string", () => {
    expect(() => timeZoneId("")).toThrow(RangeError);
  });
});

describe("TimeZone contract (via a fixed-offset fake)", () => {
  it("resolves an instant to the local calendar date at a fixed UTC offset", () => {
    const zone = timeZoneId("Fixed/Minus3");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: -180 });

    // 2026-06-15T02:00:00.000Z - 3h = 2026-06-14T23:00 local
    expect(tz.localDateAt(instant(1_781_488_800_000), zone)).toBe(localDate("2026-06-14"));
  });

  it("maps 23:59:59.999 local to day N and 00:00:00.000 local to day N+1 (SC-2)", () => {
    const zone = timeZoneId("Fixed/Minus5");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: -300 });

    // 2026-06-15T04:59:59.999Z - 5h = 2026-06-14T23:59:59.999 local
    const justBefore = instant(1_781_499_599_999);
    // 2026-06-15T05:00:00.000Z - 5h = 2026-06-15T00:00:00.000 local
    const atMidnight = instant(1_781_499_600_000);

    expect(tz.localDateAt(justBefore, zone)).toBe(localDate("2026-06-14"));
    expect(tz.localDateAt(atMidnight, zone)).toBe(localDate("2026-06-15"));
  });

  it("isValidZone accepts any non-empty string for the fixed-offset fake", () => {
    const tz = createFixedOffsetTimeZone({ offsetMinutes: 0 });

    expect(tz.isValidZone("Anything/Goes")).toBe(true);
    expect(tz.isValidZone("")).toBe(false);
  });

  it("floors (not truncates) when the offset pushes localMs negative", () => {
    const zone = timeZoneId("Fixed/Minus3");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: -180 });

    // epoch instant (0) - 3h = 1969-12-31T21:00:00 local -> the day BEFORE
    // the epoch, not the epoch's own day. Truncating division (a - a%b)
    // wrongly collapses this to day 0 ("1970-01-01") because JS's `%`
    // keeps the dividend's sign for a negative localMs.
    expect(tz.localDateAt(instant(0), zone)).toBe("1969-12-31" as LocalDate);
  });

  it("localTimeAt resolves the local date and minute of day at a fixed offset", () => {
    const zone = timeZoneId("Fixed/Minus3");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: -180 });

    // 2026-06-15T02:00:00.000Z - 3h = 2026-06-14T23:00 local
    expect(tz.localTimeAt(instant(1_781_488_800_000), zone)).toEqual({
      date: localDate("2026-06-14"),
      minuteOfDay: 23 * 60,
    });
    // 2026-06-15T05:59:59.999Z - 3h = 02:59:59.999 local: minutes are floored
    expect(tz.localTimeAt(instant(1_781_499_599_999 + 3_600_000), zone)).toEqual({
      date: localDate("2026-06-15"),
      minuteOfDay: 2 * 60 + 59,
    });
  });

  it("instantAt is the inverse of localTimeAt at a fixed offset", () => {
    const zone = timeZoneId("Fixed/Minus3");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: -180 });

    const at = tz.instantAt(localDate("2026-06-14"), 23 * 60, zone);
    expect(at).toBe(instant(1_781_488_800_000));
    expect(tz.localTimeAt(at, zone)).toEqual({ date: localDate("2026-06-14"), minuteOfDay: 1380 });
  });

  it("instantAt rejects a minute of day outside [0, 1440)", () => {
    const zone = timeZoneId("Fixed/Zero");
    const tz = createFixedOffsetTimeZone({ offsetMinutes: 0 });

    expect(() => tz.instantAt(localDate("2026-06-14"), 1440, zone)).toThrow(RangeError);
    expect(() => tz.instantAt(localDate("2026-06-14"), -1, zone)).toThrow(RangeError);
    expect(() => tz.instantAt(localDate("2026-06-14"), 1.5, zone)).toThrow(RangeError);
  });
});
