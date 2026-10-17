import { describe, expect, it } from "vitest";
import { createFixedOffsetTimeZone } from "../testing/fixed-time-zone.ts";
import { instant } from "../time/instant.ts";
import { epochDay, localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { inPlanningWindow, morningWindow, quietHoursEnd } from "./notice-timing.ts";

/** UTC-3: local 09:00 is 12:00Z. */
const tz = createFixedOffsetTimeZone({ offsetMinutes: -180 });
const zone = timeZoneId("Fixed/Minus3");
/** The instant of `hour:minute` local (UTC-3) on `date`. */
const at = (date: string, hour: number, minute = 0) =>
  instant(epochDay(localDate(date)) * 86_400_000 + (hour * 60 + minute + 180) * 60_000);

describe("morningWindow", () => {
  it("is 09:00 to 22:00 season-local on the date", () => {
    expect(morningWindow(localDate("2026-10-15"), zone, tz)).toEqual({
      notBefore: at("2026-10-15", 9),
      expiresAt: at("2026-10-15", 22),
    });
  });
});

describe("inPlanningWindow", () => {
  it.each([
    ["08:59", false],
    ["09:00", true],
    ["21:59", true],
    ["22:00", false],
  ])("at %s local: %s", (time, expected) => {
    const [h, m] = time.split(":").map(Number) as [number, number];
    expect(inPlanningWindow(at("2026-10-15", h, m), zone, tz)).toBe(expected);
  });
});

describe("quietHoursEnd (22:00-08:00 season-local)", () => {
  it("is null outside quiet hours", () => {
    expect(quietHoursEnd(at("2026-10-15", 8), zone, tz)).toBeNull();
    expect(quietHoursEnd(at("2026-10-15", 21, 59), zone, tz)).toBeNull();
  });

  it("SC-O3: late evening waits for 08:00 the next day", () => {
    expect(quietHoursEnd(at("2026-10-15", 23, 10), zone, tz)).toBe(at("2026-10-16", 8));
    expect(quietHoursEnd(at("2026-10-15", 22), zone, tz)).toBe(at("2026-10-16", 8));
  });

  it("early morning waits for 08:00 the same day", () => {
    expect(quietHoursEnd(at("2026-10-16", 0, 5), zone, tz)).toBe(at("2026-10-16", 8));
    expect(quietHoursEnd(at("2026-10-16", 7, 59), zone, tz)).toBe(at("2026-10-16", 8));
  });
});
