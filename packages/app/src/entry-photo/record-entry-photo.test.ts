import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import { type RecordEntryInput, recordEntry } from "../entry/record-entry.ts";
import { memberScore } from "../score/member-score.query.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryPhotoId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { ATTACH_WINDOW_MS } from "./limits.ts";
import { reservePhoto, uploadedPhoto } from "./photo-fixtures.ts";

const NOW = localInstant(dayOf(5));

async function setup() {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  const record = (
    target: typeof app,
    actor: typeof given.andrea,
    extra: Partial<RecordEntryInput> = {},
  ) =>
    recordEntry(target, actor, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      forDate: dayOf(5),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "req-1",
      ...extra,
    });
  const photo = (size?: number) =>
    uploadedPhoto(app, given.andrea, given, given.andreaCommitment, size);
  return { app, given, record, photo };
}

const rows = (app: Awaited<ReturnType<typeof setup>>["app"]) => app.entryPhotos.all();

describe("recordEntry with a photo", () => {
  it("SC-A1: attaches a verified photo, and the points equal those of the same entry without one", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo(4096);
    const result = await record(app, given.andrea, { photoId: p.photoId });
    expect(result.ok && result.value.entry.photoId).toBe(p.photoId);
    expect(rows(app)).toMatchObject([{ id: p.photoId, status: "attached", version: 1 }]);
    expect(app.evidence.keys()).toHaveLength(1);

    const plain = await setup();
    await plain.record(plain.app, plain.given.andrea);
    const score = (a: typeof app, g: typeof given) =>
      memberScore(a, g.andrea, { seasonId: g.season.id });
    expect(await score(app, given)).toEqual(await score(plain.app, plain.given));
  });

  it("stores the photo id in the fingerprint of the original request", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    const result = await record(app, given.andrea, { photoId: p.photoId });
    expect(result.ok && result.value.entry.requestFingerprint).toBe(
      `["quantity","30/1",null,"${p.photoId}"]`,
    );
  });

  it("a photo-less record is exactly what it was: photoId null, old fingerprint", async () => {
    const { app, given, record } = await setup();
    const result = await record(app, given.andrea);
    expect(result.ok && result.value.entry).toMatchObject({
      photoId: null,
      requestFingerprint: '["quantity","30/1",null]',
    });
    expect(rows(app)).toEqual([]);
  });

  it("an explicit photoId null is the same as none", async () => {
    const { app, given, record } = await setup();
    const result = await record(app, given.andrea, { photoId: null });
    expect(result.ok && result.value.entry.photoId).toBeNull();
  });

  it("accepts quantity 0 with a photo (for a limit, 0 is full progress)", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    const result = await record(app, given.andrea, {
      value: { kind: "quantity", value: "0" },
      photoId: p.photoId,
    });
    expect(result.ok).toBe(true);
  });

  it("SC-A2: not uploaded, expired, wrong signature or wrong size: refused, no entry, photo untouched", async () => {
    const { app, given, record } = await setup();
    const notUploaded = await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    expect(await record(app, given.andrea, { photoId: notUploaded.photoId })).toEqual({
      ok: false,
      error: { kind: "PhotoNotUploaded" },
    });

    const png = await reservePhoto(app, given.andrea, given, given.andreaCommitment, 32);
    app.evidence.upload(png.upload, new Uint8Array(32));
    expect(await record(app, given.andrea, { photoId: png.photoId })).toEqual({
      ok: false,
      error: { kind: "InvalidPhoto", reason: "notJpeg" },
    });

    const ok = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    const late = atInstant(app, (NOW + ATTACH_WINDOW_MS) as typeof NOW);
    expect(await record(late, given.andrea, { photoId: ok.photoId })).toEqual({
      ok: false,
      error: { kind: "PhotoUploadExpired" },
    });

    expect(await app.uow.read(({ entries }) => entries.listBySeason(given.season.id))).toEqual([]);
    expect(rows(app).every((r) => r.status === "pending")).toBe(true);
  });

  it("an unknown photo and a stranger's photo are both PhotoNotFound", async () => {
    const { app, given, record } = await setup();
    const victors = await uploadedPhoto(app, given.victor, given, given.victorCommitment);
    const notFound = { ok: false, error: { kind: "PhotoNotFound" } };
    expect(await record(app, given.andrea, { photoId: entryPhotoId("nope") })).toEqual(notFound);
    expect(await record(app, given.andrea, { photoId: victors.photoId })).toEqual(notFound);
  });

  it("SC-A3: a missed entry cannot carry a photo, rejected before any I/O; a note alone is fine", async () => {
    const { app, given, record } = await setup();
    app.evidence.failNext("stat", "unavailable"); // would throw if storage were touched
    expect(
      await record(app, given.andrea, {
        value: { kind: "missed" },
        photoId: entryPhotoId("anything"),
      }),
    ).toEqual({ ok: false, error: { kind: "PhotoNotAllowedOnMissed" } });
    const withNote = await record(app, given.andrea, {
      value: { kind: "missed" },
      note: "Hoy no salió",
      clientRequestId: "req-2",
    });
    expect(withNote.ok).toBe(true);
  });

  it("a photo that is already attached to an entry is PhotoNotAvailable for another", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    await record(app, given.andrea, { photoId: p.photoId });
    expect(
      await record(app, given.andrea, {
        photoId: p.photoId,
        forDate: dayOf(4),
        clientRequestId: "req-2",
      }),
    ).toEqual({ ok: false, error: { kind: "PhotoNotAvailable" } });
  });

  it("SC-A6-record: outside the entry window the record is refused and the photo stays pending", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    const result = await record(app, given.andrea, { photoId: p.photoId, forDate: dayOf(1) });
    expect(result).toMatchObject({ ok: false, error: { kind: "WindowClosed" } });
    expect(rows(app)[0]?.status).toBe("pending");
  });

  it("SC-A7: replaying the same key with the same photo returns the original without touching storage", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    const first = await record(app, given.andrea, { photoId: p.photoId });
    app.evidence.failNext("stat", "unavailable"); // a replay must not even look at storage
    const replay = await record(app, given.andrea, { photoId: p.photoId });
    expect(replay).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.ok && first.ok && replay.value.entry).toEqual(first.ok && first.value.entry);
    expect(rows(app)).toHaveLength(1);
  });

  it("SC-A7: the same key with a different photo presence is a different request", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    await record(app, given.andrea, { photoId: p.photoId });
    expect(await record(app, given.andrea)).toEqual({
      ok: false,
      error: { kind: "IdempotencyKeyReused" },
    });

    const plain = await setup();
    await plain.record(plain.app, plain.given.andrea);
    const q = await plain.photo();
    expect(await plain.record(plain.app, plain.given.andrea, { photoId: q.photoId })).toEqual({
      ok: false,
      error: { kind: "IdempotencyKeyReused" },
    });
    expect(rows(plain.app)[0]?.status).toBe("pending"); // not attached by the mismatched replay
  });

  it("SC-A7: a photo-less replay behaves as before", async () => {
    const { app, given, record } = await setup();
    await record(app, given.andrea);
    expect(await record(app, given.andrea)).toMatchObject({ ok: true, value: { replayed: true } });
  });

  it("SC-A7: a replay still works after the photo row was purged (the entry dropped its photo since)", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    await record(app, given.andrea, { photoId: p.photoId });
    await app.uow.transaction(async ({ entries, entryPhotos }) => {
      const entry = await entries.getStored(
        (await entries.listBySeason(given.season.id))[0]?.id as never,
      );
      if (!entry || entry.deleted) throw new Error("setup");
      await entries.replace({ ...entry, photoId: null, version: 1 }, 0);
      await entryPhotos.save(
        {
          ...(rows(app)[0] as NonNullable<ReturnType<typeof rows>[0]>),
          status: "released",
          version: 2,
        },
        1,
      );
      await entryPhotos.purge([p.photoId]);
      return { ok: true as const, value: undefined };
    });
    expect(rows(app)).toEqual([]);
    expect(await record(app, given.andrea, { photoId: p.photoId })).toMatchObject({
      ok: true,
      value: { replayed: true },
    });
  });

  it("SC-A8: two entries racing for one photo: one wins and the other never gets the photo", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    const race = await raceTransactions(
      app,
      (a) => record(a, given.andrea, { photoId: p.photoId, clientRequestId: "req-a" }),
      (a) =>
        record(a, given.andrea, {
          photoId: p.photoId,
          forDate: dayOf(4),
          clientRequestId: "req-b",
        }),
      "entries",
    );
    expect(race.winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    // The loser either saw the photo already attached (PhotoNotAvailable) or committed against a
    // stale view (ConcurrencyConflict, asserted deterministically in photo-lifecycle.test.ts).
    if (race.loser.status === "rejected") {
      expect(race.loser.reason).toBeInstanceOf(ConcurrencyConflict);
    } else {
      expect(race.loser.value).toEqual({ ok: false, error: { kind: "PhotoNotAvailable" } });
    }
    const entries = await app.uow.read(({ entries }) => entries.listBySeason(given.season.id));
    expect(entries.filter((e) => e.photoId === p.photoId)).toHaveLength(1);
    expect(rows(app)[0]?.status).toBe("attached");
  });

  it("lets a storage failure escape: the record is not half-done", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    app.evidence.failNext("stat", "unavailable");
    await expect(record(app, given.andrea, { photoId: p.photoId })).rejects.toMatchObject({
      name: "EvidenceStorageError",
    });
    expect(await app.uow.read(({ entries }) => entries.listBySeason(given.season.id))).toEqual([]);
    expect(rows(app)[0]?.status).toBe("pending");
  });

  it("SC-A10: leaving the circle keeps the member's entries, photos and objects", async () => {
    const { app, given, record, photo } = await setup();
    const p = await photo();
    await record(app, given.andrea, { photoId: p.photoId });
    await leaveCircle(app, given.andrea, { circleId: given.circle.id });
    expect(rows(app)).toMatchObject([{ id: p.photoId, status: "attached" }]);
    expect(app.evidence.keys()).toHaveLength(1);
    const entries = await app.uow.read(({ entries }) => entries.listBySeason(given.season.id));
    expect(entries[0]?.photoId).toBe(p.photoId);
  });
});
