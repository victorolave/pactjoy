import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, seasonId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import { createTestApp } from "./app-harness.ts";
import { seasonFixture } from "./builders.ts";

describe("createTestApp", () => {
  it("composes a Clock, IdGenerator and RandomSource that are all deterministic by default", () => {
    const app = createTestApp();

    const firstRun = {
      now: app.clock.now(),
      id: app.ids.next(),
      random: app.random.int(1000),
    };

    const secondApp = createTestApp();
    const secondRun = {
      now: secondApp.clock.now(),
      id: secondApp.ids.next(),
      random: secondApp.random.int(1000),
    };

    expect(firstRun).toEqual(secondRun);
  });

  it("accepts overrides for the fixed instant, id prefix and random seed", () => {
    const app = createTestApp({ now: instant(1234), idPrefix: "circle", randomSeed: 9 });

    expect(app.clock.now()).toBe(1234);
    expect(app.ids.next()).toBe("circle-1");
    expect(app.ids.next()).toBe("circle-2");
  });

  it("wires a real circles repository and season repository behind a working UnitOfWork (S3)", async () => {
    const app = createTestApp();
    const id = circleId("circle-1");

    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          id,
          name: "Río Runners",
          members: [],
          invite: null,
          createdAt: app.clock.now(),
          version: 0,
        },
        null,
      );
      expect(await repos.seasons.findLatestByCircle(id)).toBeNull();
      return ok(undefined);
    });

    expect((await app.uow.read((repos) => repos.circles.get(id)))?.name).toBe("Río Runners");
  });

  it("exposes the concrete circles/habits/seasons in-memory adapters directly, for GIVEN-state test setup", async () => {
    const app = createTestApp();
    const id = circleId("circle-1");

    await app.seasons.save(
      seasonFixture({ id: seasonId("season-1"), circleId: id, status: "active" }),
      null,
    );
    await app.circles.save(
      {
        id,
        name: "Río Runners",
        members: [],
        invite: null,
        createdAt: app.clock.now(),
        version: 0,
      },
      null,
    );

    expect((await app.seasons.findLatestByCircle(id))?.status).toBe("active");
    expect((await app.circles.get(id))?.name).toBe("Río Runners");
    // The same in-memory instances back uow.transaction()/uow.read() (same store, not a copy).
    expect((await app.uow.read((repos) => repos.circles.get(id)))?.name).toBe("Río Runners");
  });

  it("rolls back circles-repository writes when the transaction's work returns err", async () => {
    const app = createTestApp();
    const id = circleId("circle-1");

    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          id,
          name: "Discarded",
          members: [],
          invite: null,
          createdAt: app.clock.now(),
          version: 0,
        },
        null,
      );
      return err({ kind: "Rejected" as const });
    });

    expect(await app.uow.read((repos) => repos.circles.get(id))).toBeNull();
  });

  it("BLOCKER-1: commit() across repositories is atomic -- if ANY scope fails to validate, NEITHER scope's writes are applied", async () => {
    const app = createTestApp();
    const circleIdVal = circleId("circle-1");
    const seasonIdVal = seasonId("season-1");
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          id: circleIdVal,
          name: "Río Runners",
          members: [],
          invite: null,
          createdAt: app.clock.now(),
          version: 0,
        },
        null,
      );
      await repos.seasons.save(
        seasonFixture({ id: seasonIdVal, circleId: circleIdVal, status: "pactOpen" }),
        null,
      );
      return ok(undefined);
    });
    // Simulate a *different*, concurrently-committed write to the season
    // that this next transaction never saw (its own staged expectedVersion
    // for the season will be stale by the time it tries to commit).
    await app.seasons.save(
      seasonFixture({ id: seasonIdVal, circleId: circleIdVal, status: "active", version: 1 }),
      0,
    );

    await expect(
      app.uow.transaction(async (repos) => {
        // A valid write to the circle (its expectedVersion still matches).
        await repos.circles.save(
          {
            id: circleIdVal,
            name: "Renamed",
            members: [],
            invite: null,
            createdAt: app.clock.now(),
            version: 1,
          },
          0,
        );
        // A write to the season with a now-stale expectedVersion (0, but
        // the live version is already 1 from the concurrent write above).
        await repos.seasons.save(
          seasonFixture({ id: seasonIdVal, circleId: circleIdVal, status: "closed", version: 2 }),
          0,
        );
        return ok(undefined);
      }),
    ).rejects.toThrow(ConcurrencyConflict);

    // Neither the circle rename NOR the season close should have applied --
    // the whole transaction validates every touched repository BEFORE
    // applying any of them (no partial commit across repositories).
    expect((await app.circles.get(circleIdVal))?.name).toBe("Río Runners");
    expect((await app.seasons.get(seasonIdVal))?.status).toBe("active");
  });
});
