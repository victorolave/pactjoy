import { describe, expect, it } from "vitest";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { givenPauseWorld } from "../testing/pause-fixtures.ts";
import { pauseApprovalViews, pauseRequestViews } from "./pause-view.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";

async function setup(privateCommitment = false) {
  const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: true, withReading: true });
  if (privateCommitment) {
    const season = {
      ...world.season,
      version: world.season.version + 1,
      commitments: world.season.commitments.map((c) =>
        c.id === world.andreaCommitment ? { ...c, privacy: "private" as const } : c,
      ),
    };
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(season, world.season.version);
      return { ok: true, value: undefined };
    });
  }
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope: { kind: "all" },
    reason: "travel",
    note: "Trip",
    startDate: dayOf(6),
    endDate: dayOf(8),
  });
  if (!created.ok) throw new Error("fixture failed");
  return { app, world, record: created.value };
}

describe("pause views (D1 projections)", () => {
  it("the requester sees her Commitments, dates, and who has answered", async () => {
    const { app, world, record } = await setup();
    const answered = await respondToPause(app, world.victor, {
      pauseRequestId: record.id,
      decision: "approve",
    });
    if (!answered.ok) throw new Error("fixture failed");

    const [view] = await pauseRequestViews(app, [answered.value]);

    expect(view).toMatchObject({
      id: record.id,
      status: "pending",
      reason: "travel",
      note: "Trip",
      startDate: dayOf(6),
      endDate: dayOf(8),
      autoApproveAt: record.autoApproveAt,
      decidedAt: null,
    });
    expect(view?.commitments.map((c) => c.commitmentId)).toEqual([
      world.andreaCommitment,
      world.andreaReading,
    ]);
    expect(view?.commitments[0]).toMatchObject({ habitName: "Meditar", resumedOn: null });
    expect(view?.approvers.map((a) => [a.displayName, a.response])).toEqual([
      ["Victor", "approve"],
      ["Sofia", null],
    ]);
  });

  it("an open request has a null end date", async () => {
    const { app, world } = await setup();
    const open = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaReading },
      reason: "work",
      note: null,
      startDate: dayOf(20),
      endDate: null,
    });
    if (!open.ok) throw new Error("fixture failed");
    const [view] = await pauseRequestViews(app, [open.value]);
    expect(view?.endDate).toBeNull();
  });

  it("an approver sees the requester, their own answer and the note", async () => {
    const { app, world, record } = await setup();
    await respondToPause(app, world.victor, { pauseRequestId: record.id, decision: "approve" });

    const [mine] = await pauseApprovalViews(app, [{ request: record, myResponse: "approve" }]);
    const [sofia] = await pauseApprovalViews(app, [{ request: record, myResponse: null }]);

    expect(mine).toMatchObject({
      id: record.id,
      requester: { displayName: "Andrea" },
      myResponse: "approve",
      note: "Trip",
      startDate: dayOf(6),
      endDate: dayOf(8),
    });
    expect(sofia?.myResponse).toBeNull();
    expect(mine?.commitments[0]).toMatchObject({
      kind: "visible",
      commitmentId: world.andreaCommitment,
      habitName: "Meditar",
    });
  });

  it("a private Commitment reaches an approver as exactly { kind: hidden, commitmentId }", async () => {
    const { app, world, record } = await setup(true);

    const [view] = await pauseApprovalViews(app, [{ request: record, myResponse: null }]);

    expect(view?.commitments[0]).toStrictEqual({
      kind: "hidden",
      commitmentId: world.andreaCommitment,
    });
    expect(view?.commitments[1]).toMatchObject({ kind: "visible" });
  });
});
