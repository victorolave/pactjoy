import { describe, expect, it } from "vitest";
import { circleId, seasonId } from "../shared/ids.ts";
import { createInMemorySeasonRepository } from "../testing/in-memory-season-repository.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { buildSeason } from "./season.ts";
import { createSeasonGateReader } from "./season-gate-reader.ts";

const NOW = instant(1_700_000_000_000);

describe("createSeasonGateReader", () => {
  it("returns noSeason for a circle that never had a season", async () => {
    const seasons = createInMemorySeasonRepository();
    const reader = createSeasonGateReader(seasons);

    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("noSeason");
  });

  it("B11: maps the circle's latest season status 1:1 (pactOpen, active, closed)", async () => {
    const seasons = createInMemorySeasonRepository();
    const reader = createSeasonGateReader(seasons);
    const season = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 8,
      reviewCadenceWeeks: 2,
      now: NOW,
    });
    await seasons.save(season, null);

    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("pactOpen");

    await seasons.save({ ...season, status: "active", version: 1 }, 0);
    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("active");

    await seasons.save({ ...season, status: "closed", version: 2 }, 1);
    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("closed");
  });

  it("B11: a circle with only closed seasons reads as closed, not noSeason (joinable between seasons)", async () => {
    const seasons = createInMemorySeasonRepository();
    const reader = createSeasonGateReader(seasons);
    const closed = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 4,
      reviewCadenceWeeks: 1,
      now: NOW,
    });
    await seasons.save({ ...closed, status: "closed" }, null);

    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("closed");
  });
});
