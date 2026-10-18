import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { loadEffectivePauses, type PauseContext } from "./effective-pauses.ts";
import { dropSeasonPauses, eraseMemberPauseDetails } from "./erase.ts";
import { requestPause } from "./request-pause.ts";

async function setup() {
  const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: true });
  const ask = (
    actor: PauseWorld["andrea"],
    commitment: PauseWorld["andreaCommitment"],
    note: string,
  ) =>
    requestPause(app, actor, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: commitment },
      reason: "health",
      note,
      startDate: dayOf(5),
      endDate: null,
    });
  const mine = await ask(world.andrea, world.andreaCommitment, "SENTINEL-andrea");
  const theirs = await ask(world.victor, world.victorCommitment, "SENTINEL-victor");
  if (!mine.ok || !theirs.ok) throw new Error("setup: pause refused");
  const context: PauseContext = {
    season: world.season,
    circle: world.circle,
    now: localInstant(dayOf(5)),
    timeZone: fixtureTimeZone,
  };
  const andreaId = world.circle.members[0]?.id;
  if (!andreaId) throw new Error("setup: no Andrea");
  return { app, world, context, andreaId, mine: mine.value, theirs: theirs.value };
}

describe("eraseMemberPauseDetails", () => {
  it("blanks the note and the reason of the member's requests and touches no scoring field", async () => {
    const { app, world, context, andreaId, mine, theirs } = await setup();
    const before = await app.uow.read((repos) => loadEffectivePauses(repos, context));
    const erased = await app.uow.transaction(async (repos) =>
      ok(await eraseMemberPauseDetails(repos, context, [andreaId])),
    );
    expect(erased).toEqual(ok(1));
    const [first, second] = await app.pauses.listBySeason(world.season.id);
    expect(first).toEqual({ ...mine, note: null, reason: "other", version: mine.version + 1 });
    expect(second).toEqual(theirs);
    expect(await app.uow.read((repos) => loadEffectivePauses(repos, context))).toEqual(before);
  });

  it("keeps the responses and is a no-op the second time", async () => {
    const { app, world, context, andreaId } = await setup();
    const run = () =>
      app.uow.transaction(async (repos) =>
        ok(await eraseMemberPauseDetails(repos, context, [andreaId])),
      );
    await run();
    const afterFirst = await app.pauses.listBySeason(world.season.id);
    expect(await run()).toEqual(ok(0));
    expect(await app.pauses.listBySeason(world.season.id)).toEqual(afterFirst);
  });

  it("is a no-op for a member without requests", async () => {
    const { app, world, context } = await setup();
    const sofia = world.circle.members.find((m) => m.userId === world.sofia.userId);
    if (!sofia) throw new Error("setup: no Sofia");
    const erased = await app.uow.transaction(async (repos) =>
      ok(await eraseMemberPauseDetails(repos, context, [sofia.id])),
    );
    expect(erased).toEqual(ok(0));
    expect((await app.pauses.listBySeason(world.season.id))[0]?.note).toBe("SENTINEL-andrea");
  });

  it("loses to a concurrent write of the same request instead of overwriting it", async () => {
    const { app, world, context, andreaId, mine } = await setup();
    const scope = app.pauses.beginTransaction();
    await eraseMemberPauseDetails({ pauses: scope.repository }, context, [andreaId]);
    // A peer's response commits first, bumping the version this erasure read.
    await app.pauses.save({ ...mine, version: mine.version + 1 }, mine.version);
    expect(() => scope.validate()).toThrow(ConcurrencyConflict);
    expect((await app.pauses.listBySeason(world.season.id))[0]?.note).toBe("SENTINEL-andrea");
  });
});

describe("dropSeasonPauses", () => {
  it("deletes every request of the seasons", async () => {
    const { app, world } = await setup();
    await app.uow.transaction(async (repos) => {
      await dropSeasonPauses(repos, [world.season.id]);
      return ok(undefined);
    });
    expect(await app.pauses.listBySeason(world.season.id)).toEqual([]);
  });
});
