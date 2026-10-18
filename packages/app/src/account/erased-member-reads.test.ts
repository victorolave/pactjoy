import { describe, expect, it } from "vitest";
import { circleFeed } from "../feed/circle-feed.query.ts";
import { myPauseRequests } from "../pause/my-pause-requests.query.ts";
import { pauseApprovalViews } from "../pause/pause-view.ts";
import { commitmentProgress } from "../progress/commitment-progress.query.ts";
import { memberProgress } from "../progress/member-progress.query.ts";
import { seasonProgress } from "../progress/season-progress.query.ts";
import { seasonView } from "../season/season-view.query.ts";
import { givenAccountWorld, givenAndreaErased } from "./account-world.ts";

/**
 * Peer read models after Andrea's habits are deleted (ADR-0019 E14): her commitments are private
 * and her habits are gone, so nothing may look a habit up for them, and Victor still gets his reads.
 */
async function givenErasedAndrea() {
  const world = await givenAccountWorld();
  await givenAndreaErased(world);
  return world;
}

describe("peer read models after a member's habits are deleted", () => {
  it("shows an approver a pending Pause request of the erased member with the commitment hidden", async () => {
    const world = await givenErasedAndrea();
    const mine = await myPauseRequests(world.app, world.victor);
    expect(mine.awaitingMe.map((item) => item.request.id)).toEqual([world.andreaPause.id]);

    const views = await pauseApprovalViews(world.app, mine.awaitingMe);

    expect(views).toHaveLength(1);
    expect(views[0]?.requester).toEqual({ memberId: world.andreaId, displayName: "" });
    expect(views[0]?.commitments).toEqual([
      { kind: "hidden", commitmentId: world.andreaCommitment },
    ]);
  });

  it("still names the habit of a visible commitment whose owner is still here", async () => {
    const world = await givenErasedAndrea();

    const views = await pauseApprovalViews(world.app, [
      { request: world.victorPause, myResponse: null },
    ]);

    expect(views[0]?.commitments).toEqual([
      expect.objectContaining({
        kind: "visible",
        commitmentId: world.victorCommitment,
        habitName: "Leer",
      }),
    ]);
  });

  it("still fails loudly for a VISIBLE commitment whose habit is gone, which erasure never produces", async () => {
    const world = await givenErasedAndrea();
    await world.app.uow.transaction(async (repos) => {
      await repos.habits.deleteByOwner(world.victor.userId);
      return { ok: true as const, value: undefined };
    });

    await expect(
      pauseApprovalViews(world.app, [{ request: world.victorPause, myResponse: null }]),
    ).rejects.toThrow(`habit of commitment ${world.victorCommitment} is gone`);
  });

  it("reads the season for a peer without the erased member's habits", async () => {
    const world = await givenErasedAndrea();

    const view = await seasonView(world.app, world.victor, { seasonId: world.season.id });

    expect(view.ok && view.value.habits.map((habit) => habit.name)).toEqual(["Leer"]);
  });

  it("reads the season progress, a member's progress and the feed for a peer", async () => {
    const world = await givenErasedAndrea();
    const progress = await seasonProgress(world.app, world.victor, { seasonId: world.season.id });
    expect(progress.ok && progress.value.state).toBe("active");

    const member = await memberProgress(world.app, world.victor, {
      seasonId: world.season.id,
      memberId: world.andreaId,
    });
    expect(member.ok && member.value.state === "active" && member.value.commitments).toEqual([
      expect.objectContaining({ kind: "hidden", commitmentId: world.andreaCommitment }),
    ]);

    const feed = await circleFeed(world.app, world.victor);
    expect(feed.ok && feed.value.items.length).toBeGreaterThan(0);
  });

  it("refuses a peer the progress of the erased member's now private commitment", async () => {
    const world = await givenErasedAndrea();

    const result = await commitmentProgress(world.app, world.victor, {
      seasonId: world.season.id,
      commitmentId: world.andreaCommitment,
    });

    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });
});
