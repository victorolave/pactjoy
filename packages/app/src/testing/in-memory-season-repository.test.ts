import { describe, expect, it } from "vitest";
import { buildSeason } from "../season/season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
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

  it("delete() removes the season; findLatestByCircle() then falls back to the previous one", async () => {
    const repo = createInMemorySeasonRepository();
    const first = fixtureSeason("season-1");
    const second = fixtureSeason("season-2");
    await repo.save({ ...first, status: "closed" }, null);
    await repo.save(second, null);

    await repo.delete(second.id, second.version);

    expect(await repo.get(second.id)).toBeNull();
    expect((await repo.findLatestByCircle(circleId("circle-1")))?.id).toBe("season-1");
  });

  it("delete() rejects a stale version with ConcurrencyConflict and leaves the season in place", async () => {
    const repo = createInMemorySeasonRepository();
    const season = fixtureSeason("season-1");
    await repo.save(season, null);

    await expect(repo.delete(season.id, season.version + 1)).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
    expect(await repo.get(season.id)).toEqual(season);
  });

  it("a transactional delete is invisible outside until commit, visible inside, and discarded if never applied", async () => {
    const repo = createInMemorySeasonRepository();
    const season = fixtureSeason("season-1");
    await repo.save(season, null);
    const scope = repo.beginTransaction();

    await scope.repository.delete(season.id, season.version);

    expect(await scope.repository.get(season.id)).toBeNull();
    expect(await scope.repository.findLatestByCircle(season.circleId)).toBeNull();
    expect(await repo.get(season.id)).toEqual(season);
    scope.validate();
    scope.apply();
    expect(await repo.get(season.id)).toBeNull();
  });

  it("a transactional delete with a stale version fails validate() without mutating", async () => {
    const repo = createInMemorySeasonRepository();
    const season = fixtureSeason("season-1");
    await repo.save(season, null);
    const scope = repo.beginTransaction();
    await scope.repository.delete(season.id, season.version);
    await repo.save({ ...season, version: season.version + 1 }, season.version);

    expect(() => scope.validate()).toThrow(ConcurrencyConflict);
    expect((await repo.get(season.id))?.version).toBe(season.version + 1);
  });
});
