import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { encouragementId, seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { encouragementFixture, nudgeDismissalFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { dropSeasonEncouragements, eraseMemberEncouragements } from "./erase.ts";

const SEASON = seasonId("season-1");
const OTHER_SEASON = seasonId("season-2");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const CARLA = memberId("member-carla");

const encouragement = (
  id: string,
  sender: typeof ANDREA,
  recipient: typeof ANDREA,
  season = SEASON,
) =>
  encouragementFixture({
    id: encouragementId(id),
    seasonId: season,
    senderId: sender,
    recipientId: recipient,
    sentAt: instant(1_791_987_120_000),
    // The daily key spans seasons, so the other season's row is sent another day.
    sentOn: localDate(season === SEASON ? "2026-10-14" : "2026-10-15"),
    caseWeek: 3,
  });

const dismissal = (viewer: typeof ANDREA, target: typeof ANDREA, season = SEASON) =>
  nudgeDismissalFixture({ seasonId: season, viewerId: viewer, targetId: target, caseWeek: 3 });

async function seeded() {
  const app = createTestApp();
  await app.uow.transaction(async ({ encouragements, nudgeDismissals }) => {
    await encouragements.add(encouragement("e-v-a", VICTOR, ANDREA));
    await encouragements.add(encouragement("e-a-c", ANDREA, CARLA));
    await encouragements.add(encouragement("e-c-v", CARLA, VICTOR));
    await encouragements.add(encouragement("e-c-v-2", CARLA, VICTOR, OTHER_SEASON));
    await nudgeDismissals.add(dismissal(VICTOR, ANDREA));
    await nudgeDismissals.add(dismissal(ANDREA, CARLA));
    await nudgeDismissals.add(dismissal(CARLA, VICTOR));
    await nudgeDismissals.add(dismissal(CARLA, VICTOR, OTHER_SEASON));
    return ok(undefined);
  });
  return app;
}

describe("eraseMemberEncouragements", () => {
  it("deletes what the member received, keeps what they sent, and drops dismissals on either side", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await eraseMemberEncouragements(repos, [ANDREA]);
      return ok(undefined);
    });
    expect(await app.encouragements.listReceived(SEASON, ANDREA)).toEqual([]);
    expect((await app.encouragements.listSent(SEASON, ANDREA)).map((e) => e.id)).toEqual([
      encouragementId("e-a-c"),
    ]);
    expect((await app.encouragements.listReceived(SEASON, VICTOR)).map((e) => e.id)).toEqual([
      encouragementId("e-c-v"),
    ]);
    expect(await app.nudgeDismissals.listMine(SEASON, VICTOR)).toEqual([]);
    expect(await app.nudgeDismissals.listMine(SEASON, ANDREA)).toEqual([]);
    expect((await app.nudgeDismissals.listMine(SEASON, CARLA)).map((d) => d.targetId)).toEqual([
      VICTOR,
    ]);
  });

  it("is undone when the transaction rolls back", async () => {
    const app = await seeded();
    await expect(
      app.uow.transaction(async (repos) => {
        await eraseMemberEncouragements(repos, [ANDREA, VICTOR]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.encouragements.listReceived(SEASON, ANDREA)).toHaveLength(1);
    expect(await app.nudgeDismissals.listMine(SEASON, VICTOR)).toHaveLength(1);
  });
});

describe("dropSeasonEncouragements", () => {
  it("deletes every encouragement and dismissal of the seasons and keeps other seasons", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await dropSeasonEncouragements(repos, [SEASON]);
      return ok(undefined);
    });
    expect(await app.encouragements.listReceived(SEASON, VICTOR)).toEqual([]);
    expect(await app.encouragements.listSent(SEASON, ANDREA)).toEqual([]);
    expect(await app.nudgeDismissals.listMine(SEASON, CARLA)).toEqual([]);
    expect(await app.encouragements.listReceived(OTHER_SEASON, VICTOR)).toHaveLength(1);
    expect(await app.nudgeDismissals.listMine(OTHER_SEASON, CARLA)).toHaveLength(1);
  });
});
