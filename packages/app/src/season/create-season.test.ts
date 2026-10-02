import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput } from "../testing/circle-inputs.ts";
import { givenArchivedCircle } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { createSeason } from "./create-season.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

// Noon UTC keeps the local calendar date "2025-09-28" stable across every
// IANA offset this suite touches (avoids a UTC-midnight boundary case).
const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00.000Z

describe("createSeason", () => {
  it("new SS-17 (B1): creates a season directly with its pact open, never draft", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.season.status).toBe("pactOpen");
    expect(result.value.season.circleId).toBe(circle.value.id);
    expect(result.value.season.timeZone).toBe("America/Santiago");
    expect(result.value.season.nominalStart).toBe("2025-10-01");
    expect(result.value.season.lengthWeeks).toBe(8);

    const stored = await app.uow.read((repos) => repos.seasons.get(result.value.season.id));
    expect(stored?.status).toBe("pactOpen");
  });

  it("SS-6: defaults reviewCadenceWeeks per length when not given", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.season.reviewCadenceWeeks).toBe(2);
  });

  it("accepts an explicit reviewCadenceWeeks override", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 8,
      reviewCadenceWeeks: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.season.reviewCadenceWeeks).toBe(1);
  });

  it("SS-4: rejects a start date 31 days ahead", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-29", // 31 days after 2025-09-28
      lengthWeeks: 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "StartDateTooFarAhead" } });
  });

  it("SS-5: rejects a start date of yesterday", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-09-27",
      lengthWeeks: 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "StartDateInPast" } });
  });

  it("rejects an invalid IANA timezone", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "",
      startDate: "2025-10-01",
      lengthWeeks: 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidTimezone" } });
  });

  it("SHOULD-FIX: rejects a lengthWeeks outside {4,6,8,12} at runtime -- the HTTP adapter (C) can send arbitrary numbers despite the TS union", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 5 as unknown as 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidLengthWeeks" } });
  });

  it("SHOULD-FIX: rejects a reviewCadenceWeeks outside {1,2,3} at runtime", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 4,
      reviewCadenceWeeks: 7 as unknown as 1,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidReviewCadenceWeeks" } });
  });

  it("rejects when the circle does not exist", async () => {
    const app = createTestApp({ now: NOW });

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circleId("no-such-circle"),
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "CircleNotFound" } });
  });

  it("rejects when the actor is not an active member of the circle", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const result = await createSeason(app, actorFor("user-outsider"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 4,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("CM-12 (delta, B1): rejects a second season while the circle already has a pactOpen-or-active season", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");
    const first = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 4,
    });
    expect(first.ok).toBe(true);

    const second = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-05",
      lengthWeeks: 6,
    });

    expect(second).toEqual({ ok: false, error: { kind: "SeasonInProgress" } });
  });

  it("CM-12 (delta, B1): allows a new season once the circle's latest season is closed", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");
    const first = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 4,
    });
    if (!first.ok) throw new Error("fixture setup failed");
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save({ ...first.value.season, status: "closed", version: 1 }, 0);
      return ok(undefined);
    });

    const result = await createSeason(app, actorFor("user-andrea"), {
      circleId: circle.value.id,
      timezone: "America/Santiago",
      startDate: "2025-10-10",
      lengthWeeks: 4,
    });

    expect(result.ok).toBe(true);
  });

  it("BLOCKER-2/CM-12: two concurrent createSeason calls on the same circle race on the circle's version -- exactly one succeeds, the loser gets ConcurrencyConflict", async () => {
    const app = createTestApp({ now: NOW });
    const circle = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );
    if (!circle.ok) throw new Error("fixture setup failed");

    const [a, b] = await Promise.allSettled([
      createSeason(app, actorFor("user-andrea"), {
        circleId: circle.value.id,
        timezone: "America/Santiago",
        startDate: "2025-10-01",
        lengthWeeks: 4,
      }),
      createSeason(app, actorFor("user-andrea"), {
        circleId: circle.value.id,
        timezone: "America/Santiago",
        startDate: "2025-10-05",
        lengthWeeks: 6,
      }),
    ]);

    const settled = [a, b];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(fulfilled[0]).toMatchObject({ value: { ok: true } });

    // Exactly one season was persisted -- the winner's.
    const winner = (
      fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createSeason>>>
    ).value;
    if (!winner.ok) throw new Error("winner must be ok");
    const persisted = await app.uow.read((repos) =>
      repos.seasons.findLatestByCircle(circle.value.id),
    );
    expect(persisted?.id).toBe(winner.value.season.id);
  });

  it("rejects creating a season in an archived circle, leaving no season behind", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, andrea } = await givenArchivedCircle(app);

    const result = await createSeason(app, andrea, {
      circleId: circle.id,
      timezone: "America/Santiago",
      startDate: "2025-10-01",
      lengthWeeks: 8,
    });

    expect(result).toEqual({ ok: false, error: { kind: "CircleArchived" } });
    expect(await app.seasons.findLatestByCircle(circle.id)).toBeNull();
    expect(await app.circles.get(circle.id)).toEqual(circle);
  });
});
