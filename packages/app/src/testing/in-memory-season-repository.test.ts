import { describe, expect, it } from "vitest";
import { buildSeason } from "../season/season.ts";
import { circleId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { createInMemorySeasonRepository } from "./in-memory-season-repository.ts";

const NOW = instant(1_700_000_000_000);

function fixtureSeason(id: string, circle = "circle-1") {
  return buildSeason({
    id: seasonId(id),
    circleId: circleId(circle),
    timeZone: timeZoneId("America/Santiago"),
    nominalStart: localDate("2026-10-01"),
    lengthWeeks: 4,
    reviewCadenceWeeks: 1,
    now: NOW,
  });
}

describe("createInMemorySeasonRepository", () => {
  it("get() returns null for an unknown id, and the saved season after save()", async () => {
    const repo = createInMemorySeasonRepository();
    const season = fixtureSeason("season-1");

    expect(await repo.get(season.id)).toBeNull();

    await repo.save(season, null);

    expect(await repo.get(season.id)).toEqual(season);
  });

  it("findLatestByCircle() returns null when the circle never had a season", async () => {
    const repo = createInMemorySeasonRepository();

    expect(await repo.findLatestByCircle(circleId("circle-1"))).toBeNull();
  });

  it("findLatestByCircle() breaks ties by insertion order, not createdAt -- two seasons of the same circle can share an identical `now` (e.g. FixedClock in tests, or a coarse production clock)", async () => {
    const repo = createInMemorySeasonRepository();
    const first = fixtureSeason("season-1");
    const second = fixtureSeason("season-2"); // same `now`, same createdAt as `first`
    await repo.save({ ...first, status: "closed" }, null);
    await repo.save(second, null);

    const latest = await repo.findLatestByCircle(circleId("circle-1"));

    expect(latest?.id).toBe("season-2");
  });

  it("findLatestByCircle() ignores other circles' seasons", async () => {
    const repo = createInMemorySeasonRepository();
    await repo.save(fixtureSeason("season-1", "circle-1"), null);
    await repo.save(fixtureSeason("season-2", "circle-2"), null);

    expect((await repo.findLatestByCircle(circleId("circle-1")))?.id).toBe("season-1");
    expect((await repo.findLatestByCircle(circleId("circle-2")))?.id).toBe("season-2");
  });
});
