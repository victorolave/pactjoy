import { describe, expect, it } from "vitest";
import { createTestApp } from "../testing/app-harness.ts";
import { givenSoloOpenPact } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { leaveCircleCore } from "./leave-circle.ts";

describe("leaveCircleCore inside its caller's transaction", () => {
  it("archives a solo circle and discards its unstarted season", async () => {
    const app = createTestApp({ now: instant(1_759_233_600_000) });
    const { circle: created, season, andrea } = await givenSoloOpenPact(app);
    const circle = await app.circles.get(created.id);
    if (!circle) throw new Error("fixture requires a circle");
    const member = circle.members[0];
    if (!member) throw new Error("fixture requires a member");
    const result = await app.uow.transaction(async (repos) => {
      const left = await leaveCircleCore(repos, {
        circle,
        member,
        now: app.clock.now(),
        timeZone: app.timeZone,
      });
      return { ok: true as const, value: left };
    });
    expect(result).toMatchObject({ ok: true, value: { archivedAt: app.clock.now() } });
    expect(await app.seasons.get(season.id)).toBeNull();
    expect((await app.circles.get(circle.id))?.members[0]).toMatchObject({
      userId: andrea.userId,
      status: "left",
      leftAt: app.clock.now(),
    });
  });

  it("rolls back the leave and season removal when the caller rejects erasure", async () => {
    const app = createTestApp({ now: instant(1_759_233_600_000) });
    const { circle: created, season } = await givenSoloOpenPact(app);
    const circle = await app.circles.get(created.id);
    if (!circle) throw new Error("fixture requires a circle");
    const member = circle.members[0];
    if (!member) throw new Error("fixture requires a member");
    await app.uow.transaction(async (repos) => {
      await leaveCircleCore(repos, {
        circle,
        member,
        now: app.clock.now(),
        timeZone: app.timeZone,
      });
      return { ok: false as const, error: "abort" };
    });
    expect(await app.circles.get(circle.id)).toEqual(circle);
    expect(await app.seasons.get(season.id)).toEqual(season);
  });
});
