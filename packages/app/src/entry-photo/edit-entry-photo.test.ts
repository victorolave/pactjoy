import { describe, expect, it } from "vitest";
import { deleteEntry } from "../entry/delete-entry.ts";
import { type EditEntryInput, editEntry } from "../entry/edit-entry.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { entryPhotoId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  END_OF_DAY,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { ATTACH_WINDOW_MS } from "./limits.ts";
import { uploadedPhoto } from "./photo-fixtures.ts";

const NOW = localInstant(dayOf(5));

/** Andrea has recorded `30` with a photo on day 5; `photo()` makes further uploaded photos. */
async function setup(withPhoto = true) {
  const app = createTestApp({ now: NOW, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  const photo = (size = 2048) =>
    uploadedPhoto(app, given.andrea, given, given.andreaCommitment, size);
  const first = withPhoto ? await photo() : null;
  const recorded = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(5),
    value: { kind: "quantity", value: "30" },
    note: "original",
    clientRequestId: "req-1",
    ...(first ? { photoId: first.photoId } : {}),
  });
  if (!recorded.ok) throw new Error(`setup: ${recorded.error.kind}`);
  const edit = (extra: Partial<EditEntryInput> = {}, at = NOW) =>
    editEntry(atInstant(app, at), given.andrea, {
      entryId: recorded.value.entry.id,
      value: { kind: "quantity", value: "30" },
      note: "original",
      ...extra,
    });
  const stored = () => app.uow.read(({ entries }) => entries.get(recorded.value.entry.id));
  return { app, given, photo, first, entry: recorded.value.entry, edit, stored };
}

describe("editEntry and the photo", () => {
  it("SC-A5: omitting photoId keeps the photo and deletes nothing", async () => {
    const { app, first, edit, stored } = await setup();
    const result = await edit({ note: "changed" });
    expect(result.ok && result.value.entry.photoId).toBe(first?.photoId);
    expect((await stored())?.photoId).toBe(first?.photoId);
    expect(app.entryPhotos.all()).toMatchObject([{ id: first?.photoId, status: "attached" }]);
    expect(app.evidence.keys()).toHaveLength(1);
  });

  it("SC-A5: sending the current photo id keeps it too, and a no-op edit writes nothing", async () => {
    const { app, first, edit, stored, entry } = await setup();
    app.evidence.failNext("stat", "unavailable"); // an attached photo is not re-verified
    const result = await edit({ photoId: first?.photoId ?? null });
    expect(result).toMatchObject({ ok: true, value: { entry: { version: 0, editedAt: null } } });
    expect(await stored()).toEqual(entry);
    expect(app.evidence.keys()).toHaveLength(1);
  });

  it("SC-A5: null removes the photo: row purged, object deleted, entry keeps its value", async () => {
    const { app, edit, stored } = await setup();
    const result = await edit({ photoId: null });
    expect(result).toMatchObject({ ok: true, value: { entry: { photoId: null, version: 1 } } });
    expect((await stored())?.photoId).toBeNull();
    expect(app.entryPhotos.all()).toEqual([]);
    expect(app.evidence.keys()).toEqual([]);
  });

  it("SC-A4: a new id replaces: the new one is attached, the old released, deleted and purged", async () => {
    const { app, first, photo, edit, stored } = await setup();
    const second = await photo(4096);
    const result = await edit({ photoId: second.photoId });
    expect(result).toMatchObject({ ok: true, value: { entry: { photoId: second.photoId } } });
    expect((await stored())?.photoId).toBe(second.photoId);
    expect(app.entryPhotos.all()).toMatchObject([{ id: second.photoId, status: "attached" }]);
    expect(app.evidence.keys()).toHaveLength(1);
    expect(app.entryPhotos.all().some((p) => p.id === first?.photoId)).toBe(false);
  });

  it("adds a first photo to an entry that had none", async () => {
    const { app, photo, edit, stored } = await setup(false);
    const added = await photo();
    const result = await edit({ photoId: added.photoId });
    expect(result).toMatchObject({ ok: true, value: { entry: { photoId: added.photoId } } });
    expect((await stored())?.photoId).toBe(added.photoId);
    expect(app.entryPhotos.all()).toMatchObject([{ status: "attached" }]);
  });

  it("changing only the photo is a real edit: version and editedAt move", async () => {
    const { photo, edit } = await setup();
    const second = await photo();
    const at = localInstant(dayOf(5), 12 * 60 * 60_000 + 10 * 60_000);
    const result = await edit({ photoId: second.photoId }, at);
    expect(result).toMatchObject({ ok: true, value: { entry: { version: 1, editedAt: at } } });
  });

  it("switching to missed releases the photo (omitted, null or the current id) and purges it", async () => {
    for (const photoId of [undefined, null, "current"] as const) {
      const { app, first, edit, stored } = await setup();
      const result = await edit({
        value: { kind: "missed" },
        ...(photoId === undefined
          ? {}
          : { photoId: photoId === "current" ? (first?.photoId ?? null) : null }),
      });
      expect(result).toMatchObject({ ok: true, value: { entry: { photoId: null } } });
      expect((await stored())?.value).toEqual({ kind: "missed" });
      expect(app.entryPhotos.all()).toEqual([]);
      expect(app.evidence.keys()).toEqual([]);
    }
  });

  it("a NEW photo on a missed edit is refused before any I/O and nothing changes", async () => {
    const { app, first, photo, edit, stored } = await setup();
    const second = await photo();
    app.evidence.failNext("stat", "unavailable");
    expect(await edit({ value: { kind: "missed" }, photoId: second.photoId })).toEqual({
      ok: false,
      error: { kind: "PhotoNotAllowedOnMissed" },
    });
    expect((await stored())?.photoId).toBe(first?.photoId);
    expect(app.entryPhotos.all().find((p) => p.id === second.photoId)?.status).toBe("pending");
  });

  it("an unknown id on a missed edit is also refused", async () => {
    const { edit } = await setup();
    expect(await edit({ value: { kind: "missed" }, photoId: entryPhotoId("ghost") })).toEqual({
      ok: false,
      error: { kind: "PhotoNotAllowedOnMissed" },
    });
  });

  it("a failed edit neither attaches the new photo nor releases the old one", async () => {
    const { app, first, photo, edit, stored } = await setup();
    const second = await photo();
    const result = await edit({ photoId: second.photoId, note: "x".repeat(281) });
    expect(result).toEqual({ ok: false, error: { kind: "NoteTooLong" } });
    expect((await stored())?.photoId).toBe(first?.photoId);
    const byId = new Map(app.entryPhotos.all().map((p) => [p.id, p.status]));
    expect(byId.get(first?.photoId as never)).toBe("attached");
    expect(byId.get(second.photoId)).toBe("pending");
    expect(app.evidence.keys()).toHaveLength(2);
  });

  it.each([["unknown", () => entryPhotoId("ghost"), "PhotoNotFound"]] as const)(
    "refuses a %s new photo",
    async (_name, make, kind) => {
      const { edit } = await setup();
      expect(await edit({ photoId: make() })).toEqual({ ok: false, error: { kind } });
    },
  );

  it("refuses a new photo that is not uploaded, expired, or somebody else's", async () => {
    const { app, given, edit } = await setup();
    const { reservePhoto } = await import("./photo-fixtures.ts");
    const pending = await reservePhoto(app, given.andrea, given, given.andreaCommitment);
    expect(await edit({ photoId: pending.photoId })).toEqual({
      ok: false,
      error: { kind: "PhotoNotUploaded" },
    });
    const victors = await uploadedPhoto(app, given.victor, given, given.victorCommitment);
    expect(await edit({ photoId: victors.photoId })).toEqual({
      ok: false,
      error: { kind: "PhotoNotFound" },
    });
    const late = localInstant(dayOf(5), 12 * 60 * 60_000 + ATTACH_WINDOW_MS + 1000);
    const fresh = await uploadedPhoto(app, given.andrea, given, given.andreaCommitment);
    expect(await edit({ photoId: fresh.photoId }, late)).toEqual({
      ok: false,
      error: { kind: "PhotoUploadExpired" },
    });
  });

  it("SC-A6: with the window closed the edit is refused and the file remains", async () => {
    const { app, first, edit, stored } = await setup();
    const closed = localInstant(dayOf(9));
    const result = await edit({ photoId: null }, closed);
    expect(result).toMatchObject({ ok: false, error: { kind: "WindowClosed" } });
    expect((await stored())?.photoId).toBe(first?.photoId);
    expect(app.evidence.keys()).toHaveLength(1);
    expect(app.entryPhotos.all()[0]?.status).toBe("attached");
  });

  it("REQ-A7: a failing object delete is swallowed; the row stays released for the next sweep", async () => {
    const { app, first, edit, stored } = await setup();
    app.evidence.failNext("delete", "unavailable");
    const result = await edit({ photoId: null });
    expect(result.ok).toBe(true);
    expect((await stored())?.photoId).toBeNull();
    expect(app.entryPhotos.all()).toMatchObject([{ id: first?.photoId, status: "released" }]);
    expect(app.evidence.keys()).toHaveLength(1);
  });
});

describe("deleteEntry and the photo", () => {
  it("SC-A9: deleting releases the photo, deletes the file and leaves a tombstone without it", async () => {
    const { app, given, entry } = await setup();
    const result = await deleteEntry(app, given.andrea, { entryId: entry.id });
    expect(result.ok).toBe(true);
    expect(app.entryPhotos.all()).toEqual([]);
    expect(app.evidence.keys()).toEqual([]);
    expect(await app.uow.read(({ entries }) => entries.getStored(entry.id))).toMatchObject({
      deleted: true,
      photoId: null,
      note: null,
    });
  });

  it("deleting again is a success that touches nothing", async () => {
    const { app, given, entry } = await setup();
    await deleteEntry(app, given.andrea, { entryId: entry.id });
    app.evidence.failNext("delete", "unavailable");
    expect((await deleteEntry(app, given.andrea, { entryId: entry.id })).ok).toBe(true);
  });

  it("an entry without a photo deletes without touching storage", async () => {
    const { app, given, entry } = await setup(false);
    app.evidence.failNext("delete", "unavailable");
    expect((await deleteEntry(app, given.andrea, { entryId: entry.id })).ok).toBe(true);
  });

  it("SC-A6: with the window closed the delete is refused and the file remains", async () => {
    const { app, given, entry } = await setup();
    const result = await deleteEntry(
      atInstant(app, localInstant(dayOf(9), END_OF_DAY)),
      given.andrea,
      {
        entryId: entry.id,
      },
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "WindowClosed" } });
    expect(app.entryPhotos.all()[0]?.status).toBe("attached");
    expect(app.evidence.keys()).toHaveLength(1);
  });

  it("REQ-A7: a failing object delete is swallowed and leaves the row released", async () => {
    const { app, given, entry } = await setup();
    app.evidence.failNext("delete", "unavailable");
    expect((await deleteEntry(app, given.andrea, { entryId: entry.id })).ok).toBe(true);
    expect(app.entryPhotos.all()[0]?.status).toBe("released");
  });
});
