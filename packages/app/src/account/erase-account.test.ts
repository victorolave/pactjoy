import { fromInt, type MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { buildCommitment, commitmentId, type Measure } from "../commitment/commitment.ts";
import { storedSocial } from "../encouragement/encouragement-seed.ts";
import { ERASED_REQUEST_FINGERPRINT } from "../entry/entry.repository.ts";
import { storedPhoto } from "../entry-photo/photo-seed.ts";
import { storedPause } from "../pause/pause-seed.ts";
import { respondToPause } from "../pause/respond-to-pause.ts";
import { admitJoinAttempt } from "../rate-limit/join-attempts.ts";
import { storedReminder } from "../reminders/reminder-seed.ts";
import { givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { storedReviews } from "../review/review-seed.ts";
import { memberScore } from "../score/member-score.query.ts";
import { standings } from "../score/standings.query.ts";
import { givenClosures } from "../season/closure/closure-fixtures.ts";
import { storedClosure } from "../season/closure/closure-seed.ts";
import { circleId, encouragementId, habitId, seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { PER_DAY_REACH } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import { type AccountWorld, givenAccountWorld, OLD_SEASON_ID } from "./account-world.ts";
import { deleteAccount } from "./delete-account.ts";

const CONFIRM = { confirmation: "ELIMINAR" };

const depsOf = (world: AccountWorld) => ({
  uow: world.app.uow,
  clock: world.app.clock,
  timeZone: world.app.timeZone,
  ids: world.app.ids,
  evidence: world.app.evidence,
  identity: world.app.identity,
});

async function andreaDeletes(world: AccountWorld) {
  const result = await deleteAccount(depsOf(world), world.andrea, CONFIRM);
  expect(result).toEqual(ok(undefined));
}

describe("erasing the member an ended season still waits for (SC-C9)", () => {
  const ANDREA = memberId("member-andrea");
  const SEASON = seasonId("season-1");
  const CIRCLE = circleId("circle-1");

  /** Day 30 of a 4-week season, past the grace day: Victor is the only one with something to close. */
  async function given(closed: readonly MemberId[]) {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await givenClosures(world.app, SEASON, closed);
    const app = world.at(30);
    const season = () => app.uow.read((repos) => repos.seasons.get(SEASON));
    const erase = (actor: ReviewWorld["victor"]) =>
      deleteAccount(
        {
          uow: app.uow,
          clock: app.clock,
          timeZone: app.timeZone,
          ids: app.ids,
          evidence: app.evidence,
          identity: app.identity,
        },
        actor,
        CONFIRM,
      );
    return { world, season, erase };
  }

  it("finalizes the season and hides his visible commitment in the same transaction", async () => {
    const { world, season, erase } = await given([ANDREA]);
    const before = await season();
    expect(before?.status).toBe("active");
    expect(
      before?.commitments.filter((c) => c.id === world.victorRun).map((c) => c.privacy),
    ).toEqual(["visible"]);

    const result = await erase(world.victor);

    expect(result).toEqual(ok(undefined));
    const after = await season();
    expect(after?.status).toBe("closed");
    expect(
      after?.commitments.filter((c) => c.id === world.victorRun).map((c) => c.privacy),
    ).toEqual(["private"]);
    // One version for the finalization, one for hiding the commitment.
    expect(after?.version).toBe((before?.version ?? 0) + 2);
    expect(
      (await world.app.circles.get(CIRCLE))?.members.map((m) => [m.id, m.erasedAt !== null]),
    ).toEqual([
      [ANDREA, false],
      [memberId("member-victor"), true],
    ]);
  });

  it("does not finalize while another participant is still to close, but still hides his commitment", async () => {
    const { world, season, erase } = await given([]);

    const result = await erase(world.victor);

    expect(result).toEqual(ok(undefined));
    const after = await season();
    expect(after?.status).toBe("active");
    expect(
      after?.commitments.filter((c) => c.id === world.victorRun).map((c) => c.privacy),
    ).toEqual(["private"]);
    expect(after?.version).toBe(1);
  });
});

describe("erasing Andrea from a circle that goes on (active season)", () => {
  it("tombstones her membership: same member id, no name, no link to her user, left and erased", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);

    const circle = await world.app.circles.get(world.circle.id);
    const andrea = circle?.members.find((m) => m.id === world.andreaId);
    expect(andrea).toMatchObject({
      id: world.andreaId,
      displayName: "",
      status: "left",
      leftAt: world.app.clock.now(),
      erasedAt: world.app.clock.now(),
    });
    expect(andrea?.userId).not.toBe(world.andrea.userId);
    expect(await world.app.circles.listByUser(world.andrea.userId)).toEqual([]);
    expect(await world.app.circles.findActiveByUser(world.andrea.userId)).toBeNull();
    // Her peers are untouched.
    expect(circle?.members.filter((m) => m.status === "active").map((m) => m.displayName)).toEqual([
      "Victor",
      "Sofia",
    ]);
  });

  it("deletes her habits and hides her commitments in every season without touching the pact", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);

    expect(await world.app.habits.listByOwner(world.andrea.userId)).toEqual([]);
    expect((await world.app.habits.listByOwner(world.victor.userId)).map((h) => h.name)).toEqual([
      "Leer",
    ]);
    for (const [before, id] of [
      [world.season, world.season.id],
      [world.oldSeason, OLD_SEASON_ID],
    ] as const) {
      const after = await world.app.seasons.get(id);
      const privacies = (memberId: typeof world.andreaId) =>
        after?.commitments.filter((c) => c.memberId === memberId).map((c) => c.privacy);
      expect(privacies(world.andreaId)).toEqual(["private"]);
      expect(privacies(world.victorId)).toEqual(["visible"]);
      expect(after?.pactRevision).toBe(before.pactRevision);
      expect(after?.approvals).toEqual(before.approvals);
      expect(after?.version).toBeGreaterThan(before.version);
    }
  });

  it("blanks the free-text unit label of her hidden commitments and leaves the rest of the measure and Victor's label alone", async () => {
    const world = await givenAccountWorld();
    const cups = (customLabel: string | null): Measure => ({
      unit: "custom",
      customLabel,
      precision: "decimal",
      target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
      schedule: PER_DAY_REACH.schedule,
    });
    const victorCups = buildCommitment({
      id: commitmentId("victor-cups"),
      memberId: world.victorId,
      habitId: habitId("habit-victor"),
      weightPercent: 1,
      privacy: "visible",
      measure: cups("victor-cups"),
    });
    await world.app.uow.transaction(async (repos) => {
      // Andrea's commitment is the only quantity one in the season: give it a label, and give Victor one.
      await repos.seasons.save(
        {
          ...world.season,
          commitments: [
            ...world.season.commitments.map((c) =>
              c.id === world.andreaCommitment ? { ...c, measure: cups("SENTINEL-cups") } : c,
            ),
            victorCups,
          ],
          version: world.season.version + 1,
        },
        world.season.version,
      );
      return ok(undefined);
    });
    await andreaDeletes(world);

    const after = await world.app.seasons.get(world.season.id);
    const measureOf = (id: typeof world.andreaCommitment) =>
      after?.commitments.find((c) => c.id === id)?.measure;
    expect(measureOf(world.andreaCommitment)).toEqual(cups(null));
    expect(measureOf(commitmentId("victor-cups"))).toEqual(cups("victor-cups"));
  });

  it("keeps her entries' values and days but drops note, photo and the idempotency material", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);

    expect(world.andreaEntry.requestFingerprint).toContain("SENTINEL-andrea");
    expect(await world.app.entries.get(world.andreaEntry.id)).toEqual({
      ...world.andreaEntry,
      note: null,
      photoId: null,
      requestFingerprint: ERASED_REQUEST_FINGERPRINT,
      clientRequestId: world.andreaEntry.id,
      version: world.andreaEntry.version + 1,
    });
    // Victor's entry is exactly as he left it.
    expect(await world.app.entries.get(world.victorEntry.id)).toEqual(world.victorEntry);
  });

  it("blanks her Pause request and re-decides a peer's with the reduced approver set", async () => {
    const world = await givenAccountWorld();
    // Sofia approved Victor's request; Andrea, the other approver, never answered.
    const approved = await respondToPause(world.app, world.sofia, {
      pauseRequestId: world.victorPause.id,
      decision: "approve",
    });
    expect(approved.ok).toBe(true);
    expect((await storedPause(world.app, world.victorPause.id))?.status).toBe("pending");

    await andreaDeletes(world);

    expect(await storedPause(world.app, world.andreaPause.id)).toMatchObject({
      status: "cancelled",
      note: null,
      reason: "other",
    });
    expect(await storedPause(world.app, world.victorPause.id)).toMatchObject({
      status: "approved",
      decidedAt: world.app.clock.now(),
      note: "victor-pause",
      reason: "health",
    });
  });

  it("deletes her reviews, closures, reminders, notices, devices and received encouragements", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);
    const { app, season } = world;

    expect(await storedReviews(app, season.id, world.andreaId)).toEqual([]);
    expect(await storedReviews(app, season.id, world.victorId)).toHaveLength(1);
    expect(await storedClosure(app, OLD_SEASON_ID, world.andreaId)).toBeNull();
    expect(await storedClosure(app, OLD_SEASON_ID, world.victorId)).not.toBeNull();
    expect(await storedReminder(app, season.id, world.andreaCommitment)).toBeNull();
    expect(await storedReminder(app, season.id, world.victorCommitment)).not.toBeNull();
    expect(app.notifications.all().some((n) => n.dedupeKey === "to-andrea")).toBe(false);
    expect(app.notifications.all().some((n) => n.dedupeKey === "to-victor")).toBe(true);
    expect(app.pushSubscriptions.all().map((d) => d.userId)).toEqual([world.victor.userId]);
    const hers = await storedSocial(app, season.id, world.andreaId);
    expect(hers.received).toEqual([]);
    expect(hers.dismissed).toEqual([]);
  });

  it("deletes her join-attempt counters and keeps Victor's (ADR-0020)", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    const attempt = (actor: typeof world.andrea) =>
      admitJoinAttempt({ uow: app.uow, clock: app.clock }, actor, { networkKey: null });
    await attempt(world.andrea);
    await attempt(world.victor);

    await andreaDeletes(world);

    const now = app.clock.now();
    const minute = (actor: typeof world.andrea) => ({
      action: "joinCircle" as const,
      subject: `user:${actor.userId}`,
      windowStart: instant(now - (now % 60_000)),
      windowSeconds: 60,
    });
    const counts = await app.uow.transaction(async ({ rateLimits }) =>
      ok(await rateLimits.hit([minute(world.andrea), minute(world.victor)])),
    );
    expect(counts).toEqual(ok([1, 2]));
  });

  it("keeps what she sent (anonymous) and every peer-owned row, and her own reactions", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);
    const { app, season } = world;

    const victors = await storedSocial(app, season.id, world.victorId);
    expect(victors.received.map((e) => e.id)).toEqual([encouragementId("e-andrea-to-victor")]);
    // Victor's own dismissals: the one about Andrea went, the one about Sofia stays.
    expect(victors.dismissed.map((d) => d.targetId)).toEqual([world.sofiaId]);
    expect((await app.feedReactions.listBySeason(season.id)).map((r) => r.memberId).sort()).toEqual(
      [world.andreaId, world.victorId].sort(),
    );
  });

  it("releases and purges her photos: ledger rows and objects are gone", async () => {
    const world = await givenAccountWorld();
    expect(world.app.evidence.keys()).toHaveLength(1);

    await andreaDeletes(world);

    expect(await storedPhoto(world.app, world.attachedPhoto.photoId)).toBeNull();
    expect(await storedPhoto(world.app, world.pendingPhoto.photoId)).toBeNull();
    expect(world.app.evidence.keys()).toEqual([]);
  });

  it("calls the identity admin once, last, with her ORIGINAL user id", async () => {
    const world = await givenAccountWorld();
    await andreaDeletes(world);
    expect(world.app.identity.deleted).toEqual([world.andrea.userId]);
  });

  it("changes nothing a peer's score reads: same standings as an ordinary leave", async () => {
    const erased = await givenAccountWorld();
    const left = await givenAccountWorld();
    const victorBefore = await memberScore(erased.app, erased.victor, {
      seasonId: erased.season.id,
      memberId: erased.victorId,
    });
    await andreaDeletes(erased);
    const leave = await leaveCircle(left.app, left.andrea, { circleId: left.circle.id });
    expect(leave.ok).toBe(true);

    const ofErased = await standings(erased.app, erased.victor, { seasonId: erased.season.id });
    const ofLeft = await standings(left.app, left.victor, { seasonId: left.season.id });

    expect(ofErased).toEqual(ofLeft);
    // Victor is the only ranked participant left (leavers are not ranked).
    expect(ofErased.ok && ofErased.value.kind === "ranked" && ofErased.value.rows).toEqual([
      expect.objectContaining({ memberId: erased.victorId, displayName: "Victor" }),
    ]);
    const victorOf = (w: AccountWorld) =>
      memberScore(w.app, w.victor, { seasonId: w.season.id, memberId: w.victorId });
    expect(await victorOf(erased)).toEqual(await victorOf(left));
    expect(await victorOf(erased)).toEqual(victorBefore);
    // Her own totals, as Victor sees them, are byte-identical too: only the name and the rows change.
    const andreaOf = async (w: AccountWorld) => {
      const view = await memberScore(w.app, w.victor, {
        seasonId: w.season.id,
        memberId: w.andreaId,
      });
      if (!view.ok || view.value.kind !== "scored") throw new Error("expected a scored member");
      const { points, consistency, idealCompletion, displayName } = view.value;
      return { points, consistency, idealCompletion, displayName };
    };
    expect(await andreaOf(erased)).toEqual({
      ...(await andreaOf(left)),
      displayName: "",
    });
  });
});
