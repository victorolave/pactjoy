import { describe, expect, it } from "vitest";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { ATTACH_WINDOW_MS } from "./limits.ts";
import { reservePhoto, uploadedPhoto } from "./photo-fixtures.ts";
import { attachPhoto, releasePhoto } from "./photo-lifecycle.ts";
import { sweepEntryPhotos } from "./sweep-entry-photos.ts";

const NOW = localInstant(dayOf(5));
const AFTER = (NOW + ATTACH_WINDOW_MS + 1) as typeof NOW;

async function setup() {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, given };
}

describe("sweepEntryPhotos", () => {
  it("releases expired reservations, deletes their objects and removes the rows", async () => {
    const { app, given } = await setup();
    const a = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await reservePhoto(app, given.victor, given, given.victorCommitment);
    const result = await sweepEntryPhotos(atInstant(app, AFTER), { limit: 20 });
    expect(result).toEqual({ released: 2, purged: 2 });
    expect(app.entryPhotos.all()).toEqual([]);
    expect(app.evidence.keys()).toEqual([]);
    expect(await app.uow.read(({ entryPhotos }) => entryPhotos.get(a.photoId))).toBeNull();
  });

  it("leaves open reservations and attached photos alone", async () => {
    const { app, given } = await setup();
    const open = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const kept = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await app.uow.transaction(async (repos) => {
      await attachPhoto(repos, {
        photoId: kept.photoId,
        verifiedVersion: 0,
        memberId: "member-andrea" as never,
        seasonId: given.season.id,
        commitmentId: given.andreaCommitment,
        now: NOW,
      });
      return ok(undefined);
    });
    // Still inside the window: nothing is due.
    expect(await sweepEntryPhotos(app, { limit: 20 })).toEqual({ released: 0, purged: 0 });
    // Past the window: only the unattached one goes.
    expect(await sweepEntryPhotos(atInstant(app, AFTER), { limit: 20 })).toEqual({
      released: 1,
      purged: 1,
    });
    expect(app.entryPhotos.all().map((p) => p.id)).toEqual([kept.photoId]);
    expect(open.photoId).not.toBe(kept.photoId);
  });

  it("retries released rows whose purge failed before", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await app.uow.transaction(async (repos) => ok(await releasePhoto(repos, photo.photoId)));
    expect(await sweepEntryPhotos(app, { limit: 20 })).toEqual({ released: 0, purged: 1 });
    expect(app.evidence.keys()).toEqual([]);
  });

  it("is bounded by limit and can be scoped to one member", async () => {
    const { app, given } = await setup();
    for (let n = 0; n < 3; n++)
      await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    await reservePhoto(app, given.victor, given, given.victorCommitment);
    const later = atInstant(app, AFTER);
    expect(
      await sweepEntryPhotos(later, { memberId: "member-victor" as never, limit: 20 }),
    ).toEqual({
      released: 1,
      purged: 1,
    });
    expect(await sweepEntryPhotos(later, { limit: 2 })).toEqual({ released: 2, purged: 2 });
    expect(await sweepEntryPhotos(later, { limit: 2 })).toEqual({ released: 1, purged: 1 });
    expect(app.entryPhotos.all()).toEqual([]);
  });

  it("a failing storage keeps the rows released and never throws", async () => {
    const { app, given } = await setup();
    await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const later = atInstant(app, AFTER);
    app.evidence.failNext("delete", "unavailable");
    expect(await sweepEntryPhotos(later, { limit: 20 })).toEqual({ released: 1, purged: 0 });
    expect(app.entryPhotos.all()[0]?.status).toBe("released");
    expect(await sweepEntryPhotos(later, { limit: 20 })).toEqual({ released: 0, purged: 1 });
  });
});
