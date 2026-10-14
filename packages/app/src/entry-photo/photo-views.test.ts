import { describe, expect, it } from "vitest";
import { entryPhotoId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { DOWNLOAD_URL_TTL_SECONDS } from "./limits.ts";
import { reservePhoto, uploadedPhoto } from "./photo-fixtures.ts";
import { attachPhoto, releasePhoto } from "./photo-lifecycle.ts";
import { photoViews } from "./photo-views.ts";

const NOW = localInstant(dayOf(5));

async function setup() {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  const views = (ids: Parameters<typeof photoViews>[2]) =>
    app.uow.read((repos) => photoViews(repos, app.evidence, ids, NOW));
  return { app, given, views };
}

async function attached(
  app: Awaited<ReturnType<typeof setup>>["app"],
  given: Awaited<ReturnType<typeof setup>>["given"],
) {
  const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
  await app.uow.transaction(async (repos) => {
    await attachPhoto(repos, {
      photoId: photo.photoId,
      verifiedVersion: 0,
      memberId: "member-andrea" as never,
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      now: NOW,
    });
    return ok(undefined);
  });
  return photo;
}

describe("photoViews", () => {
  it("signs a download for each attached photo: exactly { url, expiresAt }, for the download TTL", async () => {
    const { app, given, views } = await setup();
    const a = await attached(app, given);
    const b = await attached(app, given);
    const result = await views([a.photoId, b.photoId]);
    expect([...result.keys()].sort()).toEqual([a.photoId, b.photoId].sort());
    const one = result.get(a.photoId);
    expect(Object.keys(one ?? {}).sort()).toEqual(["expiresAt", "url"]);
    expect(one?.expiresAt).toBe(NOW + DOWNLOAD_URL_TTL_SECONDS * 1000);
    expect(
      app.evidence.download({ url: one?.url ?? "", method: "GET", headers: {}, expiresAt: NOW }),
    ).not.toBeNull();
  });

  it("never signs a pending, released, unknown or duplicated id twice", async () => {
    const { app, given, views } = await setup();
    const kept = await attached(app, given);
    const pending = await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    const gone = await attached(app, given);
    await app.uow.transaction(async (repos) => ok(await releasePhoto(repos, gone.photoId)));
    const result = await views([
      kept.photoId,
      pending.photoId,
      gone.photoId,
      entryPhotoId("ghost"),
      kept.photoId,
    ]);
    expect([...result.keys()]).toEqual([kept.photoId]);
  });

  it("does not touch storage when there is nothing to sign, and never writes", async () => {
    const { app, given, views } = await setup();
    const a = await attached(app, given);
    app.evidence.failNext("signDownloads", "unavailable");
    expect((await views([])).size).toBe(0); // would have thrown if it had called storage
    const before = JSON.stringify(app.entryPhotos.all());
    app.evidence.failNext("signDownloads", "unavailable");
    await expect(views([a.photoId])).rejects.toMatchObject({ name: "EvidenceStorageError" });
    expect(JSON.stringify(app.entryPhotos.all())).toBe(before);
  });

  it("a ledger row never leaks: the view has no key, size or status", async () => {
    const { app, given, views } = await setup();
    const a = await attached(app, given);
    const text = JSON.stringify([...(await views([a.photoId]))]);
    const row = app.entryPhotos.all()[0];
    expect(text).not.toContain("attachBy");
    expect(text).not.toContain("byteSize");
    expect(text).not.toContain("status");
    expect(text).toContain(row?.objectKey ?? "missing"); // only inside the signed URL
  });
});
