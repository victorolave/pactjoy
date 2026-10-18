import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { addCommitment } from "../commitment/add-commitment.ts";
import { uploadedPhoto } from "../entry-photo/photo-fixtures.ts";
import { releaseStoredPhoto, storedPhoto } from "../entry-photo/photo-seed.ts";
import { seedNotifications } from "../notifications/notification-seed.ts";
import { storedPause } from "../pause/pause-seed.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { seasonView } from "../season/season-view.query.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, pushSubscriptionId, userId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { habitFixture } from "../testing/builders.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import { pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import {
  givenOpenPactWithOneApproval,
  givenSoloOpenPact,
  storedSeason,
} from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { today } from "../today/today.query.ts";
import { type AccountWorld, givenAccountWorld } from "./account-world.ts";
import { ACCOUNT_DELETION_CONFIRMATION, deleteAccount } from "./delete-account.ts";

const ANDREA = { userId: userId("user-andrea") };
const CONFIRM = { confirmation: "ELIMINAR" };
/** The eve of the 2025-10-01 season the pact fixtures open. */
const BEFORE_PACT_SEASON = instant(1_759_233_600_000);

function deps(app: TestApp, overrides: Partial<{ uow: UnitOfWork<Repositories> }> = {}) {
  return {
    uow: app.uow,
    clock: app.clock,
    timeZone: app.timeZone,
    ids: app.ids,
    evidence: app.evidence,
    identity: app.identity,
    ...overrides,
  };
}

describe("deleteAccount confirmation", () => {
  it("names the word the user must type", () => {
    expect(ACCOUNT_DELETION_CONFIRMATION).toBe("ELIMINAR");
  });

  it.each(["", "eliminar", "ELIMINAR AHORA", "DELETE"])(
    "refuses %j before touching anything",
    async (confirmation) => {
      const app = createTestApp();
      await app.uow.transaction(async ({ habits }) => {
        await habits.save(habitFixture({ id: habitId("habit-1"), ownerId: ANDREA.userId }), null);
        return ok(undefined);
      });

      const result = await deleteAccount(deps(app), ANDREA, { confirmation });

      expect(result).toEqual(err({ kind: "ConfirmationMismatch" }));
      expect(app.identity.deleted).toEqual([]);
      expect(await app.habits.listByOwner(ANDREA.userId)).toHaveLength(1);
    },
  );

  it("accepts the word with surrounding whitespace", async () => {
    const app = createTestApp();

    const result = await deleteAccount(deps(app), ANDREA, { confirmation: "  ELIMINAR\n" });

    expect(result).toEqual(ok(undefined));
    expect(app.identity.deleted).toEqual([ANDREA.userId]);
  });
});

describe("deleteAccount for a person with no circle", () => {
  it("deletes their habits and devices, then the identity, and leaves a peer's alone", async () => {
    const app = createTestApp();
    const victor = userId("user-victor");
    await app.uow.transaction(async ({ habits }) => {
      await habits.save(habitFixture({ id: habitId("h-a"), ownerId: ANDREA.userId }), null);
      await habits.save(habitFixture({ id: habitId("h-v"), ownerId: victor }), null);
      return ok(undefined);
    });
    await seedNotifications(app, {
      devices: [
        pushSubscriptionFixture({
          id: pushSubscriptionId("d-a"),
          userId: ANDREA.userId,
          endpoint: "https://web.push.apple.com/a",
        }),
        pushSubscriptionFixture({
          id: pushSubscriptionId("d-v"),
          userId: victor,
          endpoint: "https://web.push.apple.com/v",
        }),
      ],
    });

    const result = await deleteAccount(deps(app), ANDREA, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect((await app.habits.listByOwner(ANDREA.userId)).length).toBe(0);
    expect((await app.habits.listByOwner(victor)).map((h) => h.id)).toEqual([habitId("h-v")]);
    expect(app.pushSubscriptions.all().map((d) => d.id)).toEqual([pushSubscriptionId("d-v")]);
    expect(app.identity.deleted).toEqual([ANDREA.userId]);
  });
});

describe("deleteAccount while the pact is still open", () => {
  it("discards her commitments and resets the approvals, and the circle goes on without her invite", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    const { circle, season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const [andreaMember, victorMember] = (await app.circles.get(circle.id))?.members ?? [];
    expect((await app.circles.get(circle.id))?.invite?.createdBy).toBe(andreaMember?.id);
    expect(season.approvals).toHaveLength(1);

    const result = await deleteAccount(deps(app), andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    const after = await storedSeason(app, season.id);
    expect(after.approvals).toEqual([]);
    expect(after.commitments.map((c) => c.memberId)).toEqual([victorMember?.id]);
    const survivor = await app.circles.get(circle.id);
    expect(survivor?.invite).toBeNull();
    expect(survivor?.members.map((m) => [m.displayName, m.status, m.erasedAt !== null])).toEqual([
      ["", "left", true],
      ["Joiner", "active", false],
    ]);
    expect(await app.circles.findActiveByUser(victor.userId)).not.toBeNull();
  });

  it("keeps an invite a peer created", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    const { circle, victor } = await givenOpenPactWithOneApproval(app);
    const created = await generateInvite(app, victor, { circleId: circle.id });
    expect(created.ok).toBe(true);
    const victorMember = (await app.circles.get(circle.id))?.members[1];

    await deleteAccount(deps(app), ANDREA, CONFIRM);

    expect((await app.circles.get(circle.id))?.invite?.createdBy).toBe(victorMember?.id);
  });
});

describe("deleteAccount for the last member of a circle", () => {
  it("hard-deletes a solo circle with its open season and its invite", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const invited = await generateInvite(app, andrea, { circleId: circle.id });
    expect(invited.ok).toBe(true);

    const result = await deleteAccount(deps(app), andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(await app.circles.get(circle.id)).toBeNull();
    expect(await app.seasons.get(season.id)).toBeNull();
    expect(await app.circles.listByUser(andrea.userId)).toEqual([]);
    expect(app.identity.deleted).toEqual([andrea.userId]);
  });

  it("hard-deletes a started circle's whole tree and deletes its photo objects after the commit", async () => {
    const world = await givenAccountWorld();
    // The others leave the ordinary way first, then Victor and Sofia erase too: the LAST erasure
    // finds every member erased.
    await deleteAccount(deps(world.app), world.victor, CONFIRM);
    await deleteAccount(deps(world.app), world.sofia, CONFIRM);
    expect(await world.app.circles.get(world.circle.id)).not.toBeNull();
    expect(world.app.evidence.keys()).toHaveLength(1);

    const result = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(await world.app.circles.get(world.circle.id)).toBeNull();
    expect(await world.app.seasons.listByCircle(world.circle.id)).toEqual([]);
    expect(await world.app.entries.get(world.andreaEntry.id)).toBeNull();
    expect(await world.app.entries.get(world.victorEntry.id)).toBeNull();
    expect(await storedPause(world.app, world.andreaPause.id)).toBeNull();
    expect(await storedPhoto(world.app, world.attachedPhoto.photoId)).toBeNull();
    expect(world.app.evidence.keys()).toEqual([]);
    expect(world.app.notifications.all()).toEqual([]);
    expect(await world.app.feedReactions.listBySeason(world.season.id)).toEqual([]);
  });

  it("keeps the circle while an earlier leaver is not erased, and removes it with the last erasure", async () => {
    const world = await givenAccountWorld();
    // Sofia leaves the ordinary way and stays a person with data; Victor erases; Andrea erases.
    await leaveCircle(world.app, world.sofia, { circleId: world.circle.id });
    await deleteAccount(deps(world.app), world.victor, CONFIRM);
    await deleteAccount(deps(world.app), world.andrea, CONFIRM);

    const kept = await world.app.circles.get(world.circle.id);
    expect(kept).not.toBeNull();
    expect(kept?.archivedAt).not.toBeNull();
    expect(kept?.members.map((m) => [m.status, m.erasedAt !== null])).toEqual([
      ["left", true],
      ["left", true],
      ["left", false],
    ]);

    await deleteAccount(deps(world.app), world.sofia, CONFIRM);

    expect(await world.app.circles.get(world.circle.id)).toBeNull();
  });
});

describe("deleteAccount across several memberships", () => {
  it("tombstones the past circle she left and deletes the solo circle she is in now", async () => {
    const world = await givenAccountWorld();
    const left = await leaveCircle(world.app, world.andrea, { circleId: world.circle.id });
    expect(left.ok).toBe(true);
    const leftAt = world.app.clock.now();
    const solo = await createCircle(world.app, world.andrea, createCircleInput("Solo"));
    if (!solo.ok) throw new Error("setup: createCircle refused");

    const result = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(await world.app.circles.get(solo.value.id)).toBeNull();
    const past = await world.app.circles.get(world.circle.id);
    expect(past?.members.find((m) => m.id === world.andreaId)).toMatchObject({
      displayName: "",
      status: "left",
      leftAt,
      erasedAt: world.app.clock.now(),
    });
    expect(await world.app.circles.listByUser(world.andrea.userId)).toEqual([]);
    expect(world.app.identity.deleted).toEqual([world.andrea.userId]);
  });
});

describe("deleteAccount after the data transaction", () => {
  it("swallows a storage failure: the person is erased and the photo rows stay released for the sweep", async () => {
    const world = await givenAccountWorld();
    world.app.evidence.failNext("delete", "unavailable");

    const result = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(world.app.identity.deleted).toEqual([world.andrea.userId]);
    // The object whose delete failed is still there, its row released and waiting for the sweep.
    expect(await storedPhoto(world.app, world.attachedPhoto.photoId)).toMatchObject({
      status: "released",
    });
    expect(world.app.evidence.keys()).toHaveLength(1);
  });

  it("also deletes the object of a photo released earlier (a replaced one whose purge failed)", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    const earlier = await uploadedPhoto(app, world.andrea, world, world.andreaCommitment);
    await releaseStoredPhoto(app, earlier.photoId);
    expect(app.evidence.keys()).toHaveLength(2);

    const result = await deleteAccount(deps(app), world.andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(await storedPhoto(app, earlier.photoId)).toBeNull();
    expect(await storedPhoto(app, world.attachedPhoto.photoId)).toBeNull();
    expect(app.evidence.keys()).toEqual([]);
  });

  it.each(["unavailable", "rejected"] as const)(
    "answers IdentityUnavailable when the identity admin is %s, keeps the data erased and finishes on a retry",
    async (failure) => {
      const world = await givenAccountWorld();
      world.app.identity.setFailure(failure);

      const first = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

      expect(first).toEqual(err({ kind: "IdentityUnavailable" }));
      expect(world.app.identity.deleted).toEqual([]);
      expect(await world.app.habits.listByOwner(world.andrea.userId)).toEqual([]);
      expect(await world.app.circles.listByUser(world.andrea.userId)).toEqual([]);

      world.app.identity.setFailure(null);
      const retry = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

      expect(retry).toEqual(ok(undefined));
      expect(world.app.identity.deleted).toEqual([world.andrea.userId]);
    },
  );

  it("removes what a still-valid token wrote between the erasure and the identity deletion", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    const late = {
      ...deps(app),
      identity: {
        async deleteUser(id: typeof ANDREA.userId) {
          // The old access token still works until the identity is gone.
          await seedNotifications(app, {
            devices: [
              pushSubscriptionFixture({
                id: pushSubscriptionId("d-late"),
                userId: id,
                endpoint: "https://web.push.apple.com/late",
              }),
            ],
          });
          await app.uow.transaction(async ({ habits }) => {
            await habits.save(habitFixture({ id: habitId("h-late"), ownerId: id }), null);
            return ok(undefined);
          });
          await app.identity.deleteUser(id);
        },
      },
    };

    const result = await deleteAccount(late, world.andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    expect(await app.habits.listByOwner(world.andrea.userId)).toEqual([]);
    expect(app.pushSubscriptions.all().map((d) => d.id)).not.toContain(
      pushSubscriptionId("d-late"),
    );
    expect(app.identity.deleted).toEqual([world.andrea.userId]);
  });

  it("calls the identity admin before the photo purge", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    let objectsWhenIdentityCalled = -1;
    const spying = {
      ...deps(app),
      identity: {
        async deleteUser(id: typeof ANDREA.userId) {
          objectsWhenIdentityCalled = app.evidence.keys().length;
          await app.identity.deleteUser(id);
        },
      },
    };
    expect(app.evidence.keys()).toHaveLength(1);

    await deleteAccount(spying, world.andrea, CONFIRM);

    expect(objectsWhenIdentityCalled).toBe(1);
    expect(app.evidence.keys()).toEqual([]);
  });

  it("is a no-op the second time: nothing is written and the identity call repeats", async () => {
    const world = await givenAccountWorld();
    await deleteAccount(deps(world.app), world.andrea, CONFIRM);
    const snapshot = await snapshotOf(world);

    const again = await deleteAccount(deps(world.app), world.andrea, CONFIRM);

    expect(again).toEqual(ok(undefined));
    expect(await snapshotOf(world)).toEqual(snapshot);
    expect(world.app.identity.deleted).toEqual([world.andrea.userId, world.andrea.userId]);
  });
});

describe("deleteAccount while the old token keeps working until the identity is gone", () => {
  const CAROL = { userId: userId("user-carol") };

  /** An identity admin whose deletion first lets the still-valid token do `late`. */
  function lateWriter(app: TestApp, late: () => Promise<void>) {
    return {
      ...deps(app),
      identity: {
        async deleteUser(id: typeof CAROL.userId) {
          await late();
          await app.identity.deleteUser(id);
        },
      },
    };
  }

  it("erases a circle the token creates in the window", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    let lateCircle: string | null = null;

    const result = await deleteAccount(
      lateWriter(app, async () => {
        const created = await createCircle(app, CAROL, createCircleInput("Late", "Carol"));
        if (!created.ok) throw new Error("setup: createCircle refused");
        lateCircle = created.value.id;
      }),
      CAROL,
      CONFIRM,
    );

    expect(result).toEqual(ok(undefined));
    expect(lateCircle).not.toBeNull();
    expect(await app.circles.listByUser(CAROL.userId)).toEqual([]);
    expect(await app.circles.findActiveByUser(CAROL.userId)).toBeNull();
    expect(app.identity.deleted).toEqual([CAROL.userId]);
  });

  it("tombstones a peer's circle the token joins and drops a commitment it adds on a new habit", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, victor, { circleId: circle.id });
    if (!invite.ok) throw new Error("setup: generateInvite refused");
    // The pact fixture names Victor's habit without storing it; his reads need it to exist.
    await app.uow.transaction(async ({ habits }) => {
      await habits.save(
        habitFixture({ id: habitId("habit-user-victor"), ownerId: victor.userId }),
        null,
      );
      return ok(undefined);
    });
    const lateHabit = habitId("habit-late");

    const result = await deleteAccount(
      lateWriter(app, async () => {
        const joined = await joinCircle(app, CAROL, joinCircleInput(invite.value.code, "Carol"));
        if (!joined.ok) throw new Error("setup: joinCircle refused");
        await app.uow.transaction(async ({ habits }) => {
          await habits.save(habitFixture({ id: lateHabit, ownerId: CAROL.userId }), null);
          return ok(undefined);
        });
        const added = await addCommitment(app, CAROL, {
          seasonId: season.id,
          habitId: lateHabit,
          weightPercent: 100,
          privacy: "visible",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        });
        if (!added.ok) throw new Error("setup: addCommitment refused");
      }),
      CAROL,
      CONFIRM,
    );

    expect(result).toEqual(ok(undefined));
    const after = await app.circles.get(circle.id);
    const carolMembers = after?.members.filter((m) => m.displayName === "Carol") ?? [];
    expect(carolMembers).toEqual([]);
    expect(after?.members.filter((m) => m.userId === CAROL.userId)).toEqual([]);
    expect(after?.members.filter((m) => m.status === "active" && m.erasedAt === null)).toHaveLength(
      2,
    );
    expect(await app.circles.listByUser(CAROL.userId)).toEqual([]);
    expect(await app.habits.listByOwner(CAROL.userId)).toEqual([]);
    // The open pact discards a leaver's commitments, so none is left pointing at the deleted habit.
    const stored = await storedSeason(app, season.id);
    expect(stored.commitments.filter((c) => c.habitId === lateHabit)).toEqual([]);
    expect(stored.commitments).toHaveLength(2);
    // A peer's reads must not trip over the commitment whose habit is gone.
    const view = await seasonView(app, victor, { seasonId: season.id });
    expect(view.ok).toBe(true);
    expect((await today(app, victor)).state).not.toBe("noCircle");
  });

  it("stays idempotent when the window left something behind and the call is repeated", async () => {
    const app = createTestApp({ now: BEFORE_PACT_SEASON });
    const { circle, victor } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, victor, { circleId: circle.id });
    if (!invite.ok) throw new Error("setup: generateInvite refused");
    await deleteAccount(
      lateWriter(app, async () => {
        await joinCircle(app, CAROL, joinCircleInput(invite.value.code, "Carol"));
      }),
      CAROL,
      CONFIRM,
    );
    const snapshot = await app.circles.get(circle.id);

    const again = await deleteAccount(deps(app), CAROL, CONFIRM);

    expect(again).toEqual(ok(undefined));
    expect(await app.circles.get(circle.id)).toEqual(snapshot);
    expect(app.identity.deleted).toEqual([CAROL.userId, CAROL.userId]);
  });
});

describe("deleteAccount atomicity", () => {
  it("rolls everything back when a concurrent write wins, and never touches the identity", async () => {
    const world = await givenAccountWorld();
    const before = await snapshotOf(world);
    const racing: UnitOfWork<Repositories> = {
      read: (work) => world.app.uow.read(work),
      transaction: (work) =>
        world.app.uow.transaction(async (repos) => {
          const result = await work(repos);
          // A peer commits a change to the same circle while this transaction is open.
          await world.app.uow.transaction(async (peer) => {
            const circle = await peer.circles.get(world.circle.id);
            if (!circle) throw new Error("setup: the circle vanished");
            await peer.circles.save(
              { ...circle, name: "Renamed", version: circle.version + 1 },
              circle.version,
            );
            return ok(undefined);
          });
          return result;
        }),
    };

    await expect(
      deleteAccount(deps(world.app, { uow: racing }), world.andrea, CONFIRM),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);

    expect(world.app.identity.deleted).toEqual([]);
    const after = await snapshotOf(world);
    // Only the winner's rename is visible: no tombstone, no leave, nothing else moved.
    expect({ ...after, circle: null }).toEqual({ ...before, circle: null });
    expect(after.circle).toEqual({
      ...before.circle,
      name: "Renamed",
      version: (before.circle?.version ?? 0) + 1,
    });
  });

  it("leaves nothing half erased when the transaction fails after every erase step", async () => {
    const world = await givenAccountWorld();
    const before = await snapshotOf(world);
    const failing: UnitOfWork<Repositories> = {
      read: (work) => world.app.uow.read(work),
      transaction: (work) =>
        world.app.uow.transaction(async (repos) => {
          await work(repos);
          throw new Error("boom");
        }),
    };

    await expect(
      deleteAccount(deps(world.app, { uow: failing }), world.andrea, CONFIRM),
    ).rejects.toThrow("boom");

    expect(await snapshotOf(world)).toEqual(before);
    expect(world.app.identity.deleted).toEqual([]);
    expect(world.app.evidence.keys()).toHaveLength(1);
  });
});

/** Everything an erasure could change, read through public ports, for before/after equality. */
async function snapshotOf(world: AccountWorld) {
  const { app } = world;
  return {
    circle: await app.circles.get(world.circle.id),
    seasons: await app.seasons.listByCircle(world.circle.id),
    entries: [
      await app.entries.get(world.andreaEntry.id),
      await app.entries.get(world.victorEntry.id),
    ],
    pauses: [
      await storedPause(app, world.andreaPause.id),
      await storedPause(app, world.victorPause.id),
    ],
    habits: [
      ...(await app.habits.listByOwner(world.andrea.userId)),
      ...(await app.habits.listByOwner(world.victor.userId)),
    ],
    photo: await storedPhoto(app, world.attachedPhoto.photoId),
    notices: app.notifications.all(),
    devices: app.pushSubscriptions.all(),
    objects: app.evidence.keys(),
  };
}
