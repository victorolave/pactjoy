import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryPhotoId, userId } from "../shared/ids.ts";
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
import { jpegBytes, reservePhoto, uploadedPhoto } from "./photo-fixtures.ts";
import {
  attachPhoto,
  purgeReleased,
  releasePhoto,
  verifyUploadedPhoto,
} from "./photo-lifecycle.ts";

const NOW = localInstant(dayOf(5));

async function setup() {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, given };
}

describe("verifyUploadedPhoto", () => {
  it("passes for an uploaded JPEG of the reserved size and returns the version to attach at", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment, 5000);
    expect(await verifyUploadedPhoto(app, given.andrea, photo.photoId)).toEqual({
      ok: true,
      value: { version: 0 },
    });
  });

  it("an unknown id and somebody else's photo are the same PhotoNotFound", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const notFound = { ok: false, error: { kind: "PhotoNotFound" } };
    expect(await verifyUploadedPhoto(app, given.andrea, entryPhotoId("nope"))).toEqual(notFound);
    expect(await verifyUploadedPhoto(app, given.victor, photo.photoId)).toEqual(notFound);
    expect(
      await verifyUploadedPhoto(app, { userId: userId("user-stranger") }, photo.photoId),
    ).toEqual(notFound);
  });

  it("SC-A2: no object yet is PhotoNotUploaded", async () => {
    const { app, given } = await setup();
    const photo = await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    expect(await verifyUploadedPhoto(app, given.andrea, photo.photoId)).toEqual({
      ok: false,
      error: { kind: "PhotoNotUploaded" },
    });
  });

  it("SC-A2: an object of another size is InvalidPhoto sizeMismatch (storage refused it, or it was swapped)", async () => {
    const { app, given } = await setup();
    const photo = await reservePhoto(app, given.andrea, given, given.andreaCommitment, 100);
    const row = await app.uow.read(({ entryPhotos }) => entryPhotos.get(photo.photoId));
    // Bypass the signed URL, as an attacker who owns the S3 keys would.
    const sneaky = await app.evidence.signUpload(
      row?.objectKey ?? "",
      { size: 99, contentType: "image/jpeg" },
      60,
      NOW,
    );
    app.evidence.upload(sneaky, jpegBytes(99));
    expect(await verifyUploadedPhoto(app, given.andrea, photo.photoId)).toEqual({
      ok: false,
      error: { kind: "InvalidPhoto", reason: "sizeMismatch" },
    });
  });

  it("SC-A2: a PNG signature, or a wrong content type, is InvalidPhoto notJpeg", async () => {
    const { app, given } = await setup();
    const png = await reservePhoto(app, given.andrea, given, given.andreaCommitment, 64);
    const bytes = new Uint8Array(64);
    bytes.set([0x89, 0x50, 0x4e, 0x47]);
    expect(app.evidence.upload(png.upload, bytes)).toBe("accepted");
    expect(await verifyUploadedPhoto(app, given.andrea, png.photoId)).toEqual({
      ok: false,
      error: { kind: "InvalidPhoto", reason: "notJpeg" },
    });

    const typed = await reservePhoto(app, given.andrea, given, given.andreaCommitment, 64);
    const row = await app.uow.read(({ entryPhotos }) => entryPhotos.get(typed.photoId));
    const text = await app.evidence.signUpload(
      row?.objectKey ?? "",
      { size: 64, contentType: "text/plain" as "image/jpeg" },
      60,
      NOW,
    );
    app.evidence.upload(text, jpegBytes(64));
    expect(await verifyUploadedPhoto(app, given.andrea, typed.photoId)).toEqual({
      ok: false,
      error: { kind: "InvalidPhoto", reason: "notJpeg" },
    });
  });

  it("an expired reservation is PhotoUploadExpired, before any storage call", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const later = atInstant(app, (NOW + ATTACH_WINDOW_MS) as typeof NOW);
    app.evidence.failNext("stat", "unavailable"); // would throw if it were called
    expect(await verifyUploadedPhoto(later, given.andrea, photo.photoId)).toEqual({
      ok: false,
      error: { kind: "PhotoUploadExpired" },
    });
  });

  it("a released photo is PhotoNotAvailable; an attached one is deferred to the transaction", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await app.uow.transaction(async (repos) => {
      await attachPhoto(repos, attachInput(app, given, photo.photoId, 0));
      return ok(undefined);
    });
    app.evidence.failNext("stat", "unavailable"); // storage must not be touched for an attached row
    expect(await verifyUploadedPhoto(app, given.andrea, photo.photoId)).toEqual({
      ok: true,
      value: { version: 1 },
    });
    await app.uow.transaction(async (repos) => {
      await releasePhoto(repos, photo.photoId);
      return ok(undefined);
    });
    expect(await verifyUploadedPhoto(app, given.andrea, photo.photoId)).toEqual({
      ok: false,
      error: { kind: "PhotoNotAvailable" },
    });
  });

  it("lets a storage failure escape: it is infrastructure, not a verdict about the photo", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    app.evidence.failNext("stat", "unavailable");
    await expect(verifyUploadedPhoto(app, given.andrea, photo.photoId)).rejects.toMatchObject({
      name: "EvidenceStorageError",
      code: "unavailable",
    });
  });
});

function attachInput(
  app: Awaited<ReturnType<typeof setup>>["app"],
  given: Awaited<ReturnType<typeof setup>>["given"],
  photoId: ReturnType<typeof entryPhotoId>,
  verifiedVersion: number,
) {
  return {
    photoId,
    verifiedVersion,
    memberId: "member-andrea" as never,
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    now: app.clock.now(),
  };
}

describe("attachPhoto", () => {
  const attach = (
    app: Awaited<ReturnType<typeof setup>>["app"],
    input: ReturnType<typeof attachInput>,
  ) => app.uow.transaction(async (repos) => attachPhoto(repos, input));

  it("moves a pending photo to attached with the next version", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    expect(await attach(app, attachInput(app, given, photo.photoId, 0))).toEqual(ok(undefined));
    expect(app.entryPhotos.all()[0]).toMatchObject({ status: "attached", version: 1 });
  });

  it("refuses a photo reserved for another commitment, member or season as PhotoNotFound", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const base = attachInput(app, given, photo.photoId, 0);
    const notFound = { ok: false, error: { kind: "PhotoNotFound" } };
    expect(await attach(app, { ...base, commitmentId: given.victorCommitment })).toEqual(notFound);
    expect(await attach(app, { ...base, memberId: "member-victor" as never })).toEqual(notFound);
    expect(await attach(app, { ...base, seasonId: "season-x" as never })).toEqual(notFound);
    expect(await attach(app, { ...base, photoId: entryPhotoId("nope") })).toEqual(notFound);
    expect(app.entryPhotos.all()[0]?.status).toBe("pending");
  });

  it("refuses an attached or released photo as PhotoNotAvailable and an expired one as PhotoUploadExpired", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await attach(app, attachInput(app, given, photo.photoId, 0));
    expect(await attach(app, attachInput(app, given, photo.photoId, 1))).toEqual({
      ok: false,
      error: { kind: "PhotoNotAvailable" },
    });

    const second = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const later = atInstant(app, (NOW + ATTACH_WINDOW_MS) as typeof NOW);
    expect(await attach(later, attachInput(later, given, second.photoId, 0))).toEqual({
      ok: false,
      error: { kind: "PhotoUploadExpired" },
    });
  });

  it("SC-A8: two attaches of one verified photo, the second commits against a stale view and conflicts", async () => {
    const { app: app2, given: given2 } = await setup();
    const p2 = await uploadedPhoto(app2, given2.andrea, given2, given2.andreaCommitment);
    const stale = attachInput(app2, given2, p2.photoId, 0);
    const raced = await Promise.allSettled([
      app2.uow.transaction(async (repos) => {
        await attachPhoto(repos, stale);
        return ok(undefined);
      }),
      app2.uow.transaction(async (repos) => {
        await attachPhoto(repos, stale);
        return ok(undefined);
      }),
    ]);
    expect(raced.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (raced.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ConcurrencyConflict);
  });

  it("throws ConcurrencyConflict when the photo moved on since it was verified", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    await expect(
      app.uow.transaction(async (repos) =>
        attachPhoto(repos, attachInput(app, given, photo.photoId, 7)),
      ),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
  });
});

describe("releasePhoto and purgeReleased", () => {
  it("release moves the photo to released and returns it; releasing it again is a no-op", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const first = await app.uow.transaction(async (repos) =>
      ok(await releasePhoto(repos, photo.photoId)),
    );
    expect(first.ok && first.value).toMatchObject({ status: "released", version: 1 });
    const again = await app.uow.transaction(async (repos) =>
      ok(await releasePhoto(repos, photo.photoId)),
    );
    expect(again).toEqual(ok(null));
    expect(
      await app.uow.transaction(async (repos) =>
        ok(await releasePhoto(repos, entryPhotoId("nope"))),
      ),
    ).toEqual(ok(null));
  });

  it("purge deletes the object, then the row", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const released = await app.uow.transaction(async (repos) =>
      ok(await releasePhoto(repos, photo.photoId)),
    );
    if (!released.ok || !released.value) throw new Error("setup");
    expect(app.evidence.keys()).toHaveLength(1);
    expect(await purgeReleased(app, [released.value])).toBe(1);
    expect(app.evidence.keys()).toEqual([]);
    expect(app.entryPhotos.all()).toEqual([]);
  });

  it("REQ-A7: a storage failure is swallowed and leaves the row released for the next sweep", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const released = await app.uow.transaction(async (repos) =>
      ok(await releasePhoto(repos, photo.photoId)),
    );
    if (!released.ok || !released.value) throw new Error("setup");
    app.evidence.failNext("delete", "unavailable");
    expect(await purgeReleased(app, [released.value])).toBe(0);
    expect(app.entryPhotos.all()[0]).toMatchObject({ status: "released" });
    expect(app.evidence.keys()).toHaveLength(1);
    // The next attempt succeeds.
    expect(await purgeReleased(app, [released.value])).toBe(1);
  });

  it("a failure of the row removal is swallowed too", async () => {
    const { app, given } = await setup();
    const photo = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const released = await app.uow.transaction(async (repos) =>
      ok(await releasePhoto(repos, photo.photoId)),
    );
    if (!released.ok || !released.value) throw new Error("setup");
    const broken = {
      ...app,
      uow: {
        ...app.uow,
        transaction: async () => {
          throw new Error("db down");
        },
      },
    } as typeof app;
    expect(await purgeReleased(broken, [released.value])).toBe(0);
  });
});
