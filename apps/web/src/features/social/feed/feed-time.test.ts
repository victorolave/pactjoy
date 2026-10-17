import { describe, expect, it } from "vitest";
import { feedTime } from "./feed-time.ts";

// Saturday 10 October 2026, 15:30 on the device (no time zone is involved in the labels' day part).
const NOW = new Date(2026, 9, 10, 15, 30).getTime();
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

describe("feedTime", () => {
  it("says how long ago for today's items with a known instant", () => {
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(5) }, NOW).label).toBe("hace 5 min");
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(59) }, NOW).label).toBe("hace 59 min");
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(60) }, NOW).label).toBe("hace 1 h");
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(190) }, NOW).label).toBe("hace 3 h");
  });

  it("carries the instant in dateTime when it is shown as a relative time", () => {
    const at = minutesAgo(5);
    expect(feedTime({ onDate: "2026-10-10", at }, NOW).dateTime).toBe(at);
  });

  it("says Hoy for today's items under a minute old, in the future or without an instant", () => {
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(0) }, NOW).label).toBe("Hoy");
    expect(feedTime({ onDate: "2026-10-10", at: minutesAgo(-3) }, NOW).label).toBe("Hoy");
    expect(feedTime({ onDate: "2026-10-10", at: null }, NOW)).toEqual({
      label: "Hoy",
      dateTime: "2026-10-10",
    });
    expect(feedTime({ onDate: "2026-10-11", at: null }, NOW).label).toBe("Hoy");
  });

  it("says Ayer for yesterday, even when the instant is known", () => {
    expect(feedTime({ onDate: "2026-10-09", at: minutesAgo(600) }, NOW)).toEqual({
      label: "Ayer",
      dateTime: "2026-10-09",
    });
  });

  it("names the weekday for the days before that, up to six days back", () => {
    expect(feedTime({ onDate: "2026-10-08", at: null }, NOW).label).toBe("Jueves");
    expect(feedTime({ onDate: "2026-10-07", at: null }, NOW).label).toBe("Miércoles");
    expect(feedTime({ onDate: "2026-10-04", at: null }, NOW).label).toBe("Domingo");
  });

  it("gives the day and month from a week back, with the year only when it differs", () => {
    expect(feedTime({ onDate: "2026-10-03", at: null }, NOW)).toEqual({
      label: "3 de octubre",
      dateTime: "2026-10-03",
    });
    expect(feedTime({ onDate: "2026-08-25", at: null }, NOW).label).toBe("25 de agosto");
    expect(feedTime({ onDate: "2025-12-01", at: null }, NOW).label).toBe("1 de diciembre de 2025");
  });

  it("agrees with the feed's own groups: Hoy, Ayer + weekdays, then dates", () => {
    // groupFeed puts ages 1..6 in "Esta semana" and 7+ in "Antes".
    expect(feedTime({ onDate: "2026-10-04", at: null }, NOW).label).toBe("Domingo");
    expect(feedTime({ onDate: "2026-10-03", at: null }, NOW).label).toBe("3 de octubre");
  });
});
