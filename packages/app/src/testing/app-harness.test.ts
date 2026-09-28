import { describe, expect, it } from "vitest";
import { circleId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import { createTestApp } from "./app-harness.ts";

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

  it("wires a real circles repository and season-gate reader behind a working UnitOfWork (S3)", async () => {
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
      expect(await repos.seasonGate.statusForCircle(id)).toBe("noSeason");
      return ok(undefined);
    });

    expect((await app.uow.read((repos) => repos.circles.get(id)))?.name).toBe("Río Runners");
  });

  it("exposes the concrete circles/seasonGate in-memory adapters directly, for GIVEN-state test setup", async () => {
    const app = createTestApp();
    const id = circleId("circle-1");

    app.seasonGate.setStatus(id, "active");
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

    expect(await app.seasonGate.statusForCircle(id)).toBe("active");
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
});
