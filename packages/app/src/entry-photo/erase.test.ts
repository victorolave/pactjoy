import type { MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { entryPhotoId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { entryPhotoFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import {
  deleteObjects,
  dropSeasonPhotos,
  PURGE_BATCH,
  PURGE_MAX_BATCHES,
  purgeErasedPhotos,
  releaseMemberPhotos,
} from "./erase.ts";
import { uploadedPhoto } from "./photo-fixtures.ts";
import { attachPhoto } from "./photo-lifecycle.ts";

const NOW = localInstant(dayOf(5));
const ANDREA = "member-andrea" as MemberId;

async function setup() {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  const pending = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
  const attached = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
  await app.uow.transaction(async (repos) => {
    await attachPhoto(repos, {
      photoId: attached.photoId,
      verifiedVersion: 0,
      memberId: ANDREA,
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      now: NOW,
    });
    return ok(undefined);
  });
  const peer = await uploadedPhoto(app, given.victor, given, given.victorCommitment);
  return { app, given, pending, attached, peer };
}

describe("releaseMemberPhotos", () => {
  it("releases the pending and attached photos of the members and leaves a peer's alone", async () => {
    const { app, pending, attached, peer } = await setup();
    const released = await app.uow.transaction(async (repos) =>
      ok(await releaseMemberPhotos(repos, [ANDREA])),
    );
    expect(released.ok && released.value.map((p) => p.id).sort()).toEqual(
      [pending.photoId, attached.photoId].sort(),
    );
    expect(released.ok && released.value.every((p) => p.status === "released")).toBe(true);
    const status = (id: typeof peer.photoId) =>
      app.entryPhotos.all().find((p) => p.id === id)?.status;
    expect(status(pending.photoId)).toBe("released");
    expect(status(attached.photoId)).toBe("released");
    expect(status(peer.photoId)).toBe("pending");
  });

  it("rolls back with the transaction", async () => {
    const { app, pending } = await setup();
    await expect(
      app.uow.transaction(async (repos) => {
        await releaseMemberPhotos(repos, [ANDREA]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(app.entryPhotos.all().find((p) => p.id === pending.photoId)?.status).toBe("pending");
  });
});

describe("dropSeasonPhotos", () => {
  it("deletes every ledger row of the seasons whatever its status and returns them", async () => {
    const { app, given, pending, attached, peer } = await setup();
    const dropped = await app.uow.transaction(async (repos) =>
      ok(await dropSeasonPhotos(repos, [given.season.id])),
    );
    expect(dropped.ok && dropped.value.map((p) => p.id).sort()).toEqual(
      [pending.photoId, attached.photoId, peer.photoId].sort(),
    );
    expect(app.entryPhotos.all()).toEqual([]);
  });
});

describe("purgeErasedPhotos", () => {
  it("deletes the objects of the released rows, then the rows", async () => {
    const { app, pending, attached, peer } = await setup();
    const released = await app.uow.transaction(async (repos) =>
      ok(await releaseMemberPhotos(repos, [ANDREA])),
    );
    if (!released.ok) throw new Error("setup");
    expect(app.evidence.keys()).toHaveLength(3);
    expect(await purgeErasedPhotos(app, released.value)).toEqual({ purged: 2, left: 0 });
    expect(app.entryPhotos.all().map((p) => p.id)).toEqual([peer.photoId]);
    expect(app.evidence.keys()).toHaveLength(1);
    expect(pending.photoId).not.toBe(attached.photoId);
  });

  it("swallows a storage failure, keeps that row released for the next sweep and counts it", async () => {
    const { app } = await setup();
    const released = await app.uow.transaction(async (repos) =>
      ok(await releaseMemberPhotos(repos, [ANDREA])),
    );
    if (!released.ok) throw new Error("setup");
    app.evidence.failNext("delete", "unavailable");
    expect(await purgeErasedPhotos(app, released.value)).toEqual({ purged: 1, left: 1 });
    expect(app.entryPhotos.all().filter((p) => p.status === "released")).toHaveLength(1);
  });

  it("works in bounded batches and leaves the rest to the sweep", async () => {
    const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
    const total = PURGE_BATCH * PURGE_MAX_BATCHES + 5;
    const rows = Array.from({ length: total }, (_, n) =>
      entryPhotoFixture({
        id: entryPhotoId(`bulk-${n}`),
        objectKey: `o/${n.toString(16).padStart(32, "0")}.jpg`,
        memberId: ANDREA,
        status: "released",
        version: 1,
      }),
    );
    await app.uow.transaction(async ({ entryPhotos }) => {
      for (const row of rows) await entryPhotos.add(row);
      return ok(undefined);
    });
    expect(await purgeErasedPhotos(app, rows)).toEqual({
      purged: PURGE_BATCH * PURGE_MAX_BATCHES,
      left: 5,
    });
    expect(app.entryPhotos.all()).toHaveLength(5);
  });

  it("never throws when the ledger itself is unavailable", async () => {
    const { app } = await setup();
    const released = await app.uow.transaction(async (repos) =>
      ok(await releaseMemberPhotos(repos, [ANDREA])),
    );
    if (!released.ok) throw new Error("setup");
    const broken = {
      evidence: app.evidence,
      uow: {
        ...app.uow,
        transaction: () => Promise.reject(new Error("db down")),
      },
    } as unknown as Parameters<typeof purgeErasedPhotos>[0];
    expect(await purgeErasedPhotos(broken, released.value)).toEqual({ purged: 0, left: 2 });
  });
});

describe("deleteObjects", () => {
  it("deletes the objects of dropped rows and counts failures without throwing", async () => {
    const { app, given } = await setup();
    const dropped = await app.uow.transaction(async (repos) =>
      ok(await dropSeasonPhotos(repos, [given.season.id])),
    );
    if (!dropped.ok) throw new Error("setup");
    app.evidence.failNext("delete", "unavailable");
    expect(await deleteObjects(app, dropped.value)).toEqual({ deleted: 2, failed: 1 });
    expect(app.evidence.keys()).toHaveLength(1);
    expect(await deleteObjects(app, [])).toEqual({ deleted: 0, failed: 0 });
  });
});
